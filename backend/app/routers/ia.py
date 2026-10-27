import hashlib
import json
import logging
import re
import unicodedata
from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Form, HTTPException, Request, UploadFile

from app.core.config import settings
from app.core.db import get_db, get_redis
from app.core.imagen import (
    FormatoImagenNoPermitido,
    ImagenDemasiadoGrande,
    ImagenNoProcesable,
    leer_y_validar_imagen,
)
from app.core.limiter import clave_usuario, limiter
from app.core.security import require_permiso
from app.schemas.duplicado import AdhesionOut, ConfirmarAdhesionIn
from app.schemas.ia import AnalisisImagen, DecisionAsistida, EventoIAIn, EventoIAOut, RespuestaIA
from app.schemas.config import ConfigIA
from app.services.config_ia import ConfiguracionIANoDisponible, obtener_config_ia
from app.services.duplicados import (
    CoincidenciaNoElegible,
    CoincidenciaNoEncontrada,
    confirmar_adhesion,
)
from app.services import ia as ia_service
from app.services.ia import PROMPT_VERSION, IAError, analizar_imagen, identidad_proveedor
from app.services.vision.analisis_temporal import RegistroAnalisis, cargar_analisis, guardar_analisis
from app.services.vision.compuertas import EntradaCompuertas, UbicacionCompuertas, evaluar_compuertas, mapeo_valido
from app.services.vision.cupos import consumir_cupo_agentico, cupo_usuario_disponible
from app.services.vision.decision import decidir
from app.services.ia_eventos import (
    EventoIAConflictivo,
    OfertaIAAjena,
    OfertaIANoEncontrada,
    OfertaIAVencida,
    registrar_evento_cliente,
)

router = APIRouter(prefix="/ia", tags=["ia"])
logger = logging.getLogger(__name__)

CACHE_TTL = 24 * 3600
CUPO_TTL = 2 * 24 * 3600

_CONSUMIR_CUPO = """
local uso_usuario = tonumber(redis.call('GET', KEYS[1]) or '0')
if uso_usuario >= tonumber(ARGV[1]) then
    return {0, uso_usuario}
end
local uso_global = tonumber(redis.call('GET', KEYS[2]) or '0')
if uso_global >= tonumber(ARGV[2]) then
    return {-1, uso_global}
end
uso_usuario = redis.call('INCR', KEYS[1])
uso_global = redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[1], ARGV[3])
redis.call('EXPIRE', KEYS[2], ARGV[3])
return {1, uso_usuario, uso_global}
"""

_DEVOLVER_CUPO = """
for i = 1, 2 do
    local uso = tonumber(redis.call('GET', KEYS[i]) or '0')
    if uso > 0 then redis.call('DECR', KEYS[i]) end
end
return 1
"""


def _minimizar_contexto(contexto: str | None, usuario: dict) -> str | None:
    """Conserva solo el texto necesario y elimina datos del perfil autenticado."""
    if contexto is None:
        return None
    limpio = contexto
    for campo in ("nombre", "correo"):
        valor = usuario.get(campo)
        if isinstance(valor, str) and valor:
            limpio = re.sub(re.escape(valor), "[dato omitido]", limpio, flags=re.IGNORECASE)
    return limpio


def _normalizar_contexto(contexto: str | None) -> str:
    if not contexto:
        return ""
    return " ".join(unicodedata.normalize("NFKC", contexto).split())


def _clave_cache(
    datos: bytes, contexto: str | None, *, usuario_id: object, prompt_version: str, proveedor: str, modelo: str
) -> str:
    # La clave incluye al usuario: la caché no es compartida para no revelar qué fotos subió otra persona.
    componentes = {
        "usuario_id": str(usuario_id),
        "imagen_sha256": hashlib.sha256(datos).hexdigest(),
        "pistas": {"contexto": _normalizar_contexto(contexto)},
        "prompt_version": prompt_version,
        "proveedor": proveedor,
        "modelo": modelo,
    }
    serializado = json.dumps(componentes, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return f"ia:cache:{hashlib.sha256(serializado.encode()).hexdigest()}"


def _claves_cupo(usuario_id: object, ahora: datetime) -> tuple[str, str]:
    dia = f"{ahora:%Y-%m-%d}"
    return f"ia:uso:{usuario_id}:{dia}", f"ia:uso:global:{dia}"


async def _consumir_cupo(redis, claves: tuple[str, str], *, limite_usuario: int, limite_global: int) -> None:
    resultado = await redis.eval(_CONSUMIR_CUPO, 2, *claves, limite_usuario, limite_global, CUPO_TTL)
    estado = int(resultado[0])
    if estado == 0:
        raise HTTPException(429, f"Alcanzaste el límite de {limite_usuario} análisis por día")
    if estado == -1:
        raise HTTPException(503, "El análisis con IA no está disponible por hoy")


def _estado_por_verificar(usuario: dict) -> tuple[UbicacionCompuertas | None, str]:
    """Ubicación verificada (T17/T18) y evidencia de duplicados (T22) todavía no existen.

    Mientras tanto la ubicación es ``None`` y el duplicado ``no_verificable``: G5, G7 y G8 fallan, así que el modo
    agéntico es inalcanzable a propósito y la salida segura es ``formulario`` (aunque el kill switch esté encendido).
    """
    return None, "no_verificable"


# Pistas del control de calidad del cliente (frontend/src/lib/calidad.ts); cualquiera hace fallar G4.
CALIDADES_CLIENTE = frozenset({"borrosa", "oscura", "sobreexpuesta"})


def _calidad_cliente(valor: str | None) -> tuple[str, ...]:
    """``"borrosa,oscura"`` → ``("borrosa", "oscura")``; 400 si trae una pista desconocida."""
    pistas = tuple(dict.fromkeys(p.strip() for p in (valor or "").split(",") if p.strip()))
    if any(p not in CALIDADES_CLIENTE for p in pistas):
        raise HTTPException(400, "calidad_cliente solo acepta: borrosa, oscura, sobreexpuesta")
    return pistas


def _entrada_compuertas(
    analisis: AnalisisImagen,
    usuario: dict,
    ahora: datetime,
    config: ConfigIA,
    *,
    cupo_agentico_disponible: bool,
    calidad_cliente: tuple[str, ...] = (),
) -> EntradaCompuertas:
    ubicacion, duplicado = _estado_por_verificar(usuario)
    return EntradaCompuertas(
        analisis=analisis,
        ahora=ahora,
        calidad_cliente=calidad_cliente,
        ubicacion=ubicacion,
        esquema_valido=mapeo_valido(analisis, ubicacion),
        duplicado=duplicado,
        permisos=frozenset(usuario.get("_permisos", ())),
        cupo_agentico_disponible=cupo_agentico_disponible,
        modo_agentico_habilitado=config.modo_agentico_habilitado,
        categorias_agenticas=frozenset(config.categorias_agenticas),
    )


async def _cupo_agentico_previo(redis, usuario: dict, config: ConfigIA, ahora: datetime) -> bool:
    """G9 consulta el cupo agéntico ANTES de llamar a la IA; sin Redis se considera agotado (falla cerrado)."""
    if redis is None:
        return False
    try:
        return await cupo_usuario_disponible(redis, usuario["_id"], ahora, limite=config.cupo_agentico_usuario_diario)
    except Exception:
        logger.warning("Redis no disponible al consultar el cupo agéntico", exc_info=True)
        return False


def _mensaje(accion: str, asistida: DecisionAsistida) -> str:
    if accion == "agentico":
        return "El reporte cumple las condiciones para continuar en modo agéntico."
    if accion == "duplicado":
        return "Encontramos un posible reporte duplicado; confirma cómo deseas continuar."
    return asistida.mensaje


async def _responder(
    redis,
    usuario: dict,
    datos: bytes,
    analisis: AnalisisImagen,
    *,
    cache: bool,
    config: ConfigIA,
    ahora: datetime,
    cupo_agentico_disponible: bool,
    calidad_cliente: tuple[str, ...] = (),
) -> RespuestaIA:
    """Evalúa G1–G9, emite un analisis_id opaco y guarda el contexto temporal (falla cerrado sin Redis)."""
    # Las pistas del cliente (borrosa/oscura/sobreexpuesta) también topan la confianza: nunca autollena.
    asistida = decidir(analisis, calidad_cliente, cache=cache)
    entrada = _entrada_compuertas(
        analisis,
        usuario,
        ahora,
        config,
        cupo_agentico_disponible=cupo_agentico_disponible,
        calidad_cliente=calidad_cliente,
    )
    decision = evaluar_compuertas(entrada)
    if decision.accion == "agentico" and entrada.ubicacion is not None:
        try:
            await consumir_cupo_agentico(
                redis,
                usuario["_id"],
                entrada.ubicacion.datos,
                ahora,
                limite_usuario=config.cupo_agentico_usuario_diario,
                limite_aula=config.cupo_agentico_aula_hora,
            )
        except Exception:
            # Cupo agotado (carrera) o Redis caído: se degrada a formulario; el análisis ya pagado no se pierde.
            logger.info("Cupo agéntico no disponible; se ofrece el formulario", exc_info=True)
            entrada = entrada.model_copy(update={"cupo_agentico_disponible": False})
            decision = evaluar_compuertas(entrada)
    respuesta = RespuestaIA(
        accion=decision.accion,
        motivos=list(decision.motivos),
        analisis_id=uuid4(),
        analisis=asistida.analisis,
        accion_asistida=asistida.accion,
        mensaje=_mensaje(decision.accion, asistida),
        cache=cache,
    )
    registro = RegistroAnalisis(
        usuario_id=str(usuario["_id"]),
        imagen_sha256=hashlib.sha256(datos).hexdigest(),
        respuesta=respuesta,
        compuertas=decision.compuertas,
        prompt_version=PROMPT_VERSION,
        creado_en=ahora,
    )
    try:
        await guardar_analisis(redis, registro)
    except Exception as error:
        # El análisis ya quedó en caché: reintentar no vuelve a costar cupo.
        raise HTTPException(503, "El análisis temporal no está disponible") from error
    return respuesta


@router.post(
    "/analizar-imagen",
    response_model=RespuestaIA,
    response_model_exclude_none=True,
    responses={
        413: {
            "description": "El archivo supera 5 MB",
            "content": {"application/json": {"example": {"detalle": "La imagen excede 5 MB"}}},
        },
        415: {
            "description": "El contenido no es JPEG, PNG ni WebP",
            "content": {"application/json": {"example": {"detalle": "Formato no permitido (usa JPEG, PNG o WebP)"}}},
        },
        400: {
            "description": "La imagen está corrupta o sus dimensiones están fuera de 200–2600 px",
            "content": {
                "application/json": {
                    "example": {
                        "detalle": "La imagen está corrupta o sus dimensiones están fuera del rango permitido (200–2600 px)"
                    }
                }
            },
        },
    },
)
async def analizar(
    imagen: UploadFile,
    usuario: Annotated[dict, Depends(require_permiso("ia:usar"))],
    contexto: Annotated[str | None, Form(max_length=500)] = None,
    calidad_cliente: Annotated[str | None, Form(max_length=60)] = None,
):
    pistas_calidad = _calidad_cliente(calidad_cliente)
    try:
        validada = await leer_y_validar_imagen(imagen)
    except ImagenDemasiadoGrande as exc:
        raise HTTPException(413, "La imagen excede 5 MB") from exc
    except FormatoImagenNoPermitido as exc:
        raise HTTPException(415, "Formato no permitido (usa JPEG, PNG o WebP)") from exc
    except ImagenNoProcesable as exc:
        raise HTTPException(
            400, "La imagen está corrupta o sus dimensiones están fuera del rango permitido (200–2600 px)"
        ) from exc
    try:
        config = await obtener_config_ia()
    except ConfiguracionIANoDisponible as exc:
        raise HTTPException(503, "La configuración de IA no está disponible") from exc
    if not config.habilitada:
        raise HTTPException(503, "El análisis con IA está deshabilitado")
    # Lista de datos permitidos para el proveedor: imagen, MIME y contexto sin datos del perfil.
    contexto_normalizado = _normalizar_contexto(_minimizar_contexto(contexto, usuario))
    proveedor, modelo = identidad_proveedor()
    clave_cache = _clave_cache(
        validada.datos,
        contexto_normalizado,
        usuario_id=usuario["_id"],
        prompt_version=PROMPT_VERSION,
        proveedor=proveedor,
        modelo=modelo,
    )
    redis = None
    analisis_cache = None
    try:
        redis = get_redis()
        guardado = await redis.get(clave_cache)
        if guardado is not None:
            try:
                analisis_cache = AnalisisImagen.model_validate_json(guardado)
            except ValueError:
                logger.warning("Entrada inválida en la caché de IA; se regenerará", exc_info=True)
    except Exception:
        logger.warning("Redis no disponible al consultar la caché de IA", exc_info=True)
    ahora = datetime.now(timezone.utc)
    cupo_agentico = await _cupo_agentico_previo(redis, usuario, config, ahora)
    contexto_respuesta = {
        "config": config,
        "ahora": ahora,
        "cupo_agentico_disponible": cupo_agentico,
        "calidad_cliente": pistas_calidad,
    }
    if analisis_cache is not None:
        return await _responder(redis, usuario, validada.datos, analisis_cache, cache=True, **contexto_respuesta)

    # Falla cerrado: si no se puede contabilizar el cupo no se llama al proveedor (el costo queda acotado).
    claves_cupo = _claves_cupo(usuario["_id"], datetime.now(timezone.utc))
    try:
        if redis is None:
            raise RuntimeError("Redis no disponible")
        await _consumir_cupo(
            redis,
            claves_cupo,
            limite_usuario=config.limite_diario_usuario,
            limite_global=config.limite_diario_global,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Redis no disponible al consumir el cupo de IA", exc_info=True)
        raise HTTPException(503, "El análisis con IA no está disponible en este momento") from exc

    try:
        # El reintento queda dentro: si todo falla el cupo se devuelve una sola vez.
        analisis = await ia_service.con_reintento_transitorio(
            lambda: analizar_imagen(validada.datos, validada.tipo_mime, contexto_normalizado or None)
        )
    except Exception as e:  # IAError, errores de red/API, JSON inválido
        # Registra la causa (sin datos de la imagen ni llaves) para poder diagnosticar (#132).
        logger.warning(
            "Fallo del proveedor de IA: proveedor=%s tipo=%s error=%s",
            settings.ia_proveedor,
            getattr(e, "tipo", "desconocido"),
            type(e).__name__,
        )
        try:
            await redis.eval(_DEVOLVER_CUPO, 2, *claves_cupo)
        except Exception:
            logger.error("No se pudo devolver el cupo tras un fallo del proveedor de IA", exc_info=True)
        raise HTTPException(503, "No fue posible analizar la imagen; llena el formulario manualmente") from e

    try:
        await redis.set(clave_cache, analisis.model_dump_json(), ex=CACHE_TTL)
    except Exception:
        logger.warning("Redis no disponible al guardar la caché de IA", exc_info=True)
    return await _responder(redis, usuario, validada.datos, analisis, cache=False, **contexto_respuesta)


@router.post(
    "/eventos",
    response_model=EventoIAOut,
    summary="Registrar una interacción con una oferta de IA",
    responses={
        400: {"description": "Evento o identificador inválido"},
        401: {"description": "Autenticación requerida"},
        403: {"description": "Falta el permiso ia:usar"},
        404: {"description": "Oferta inexistente o de otro usuario"},
        409: {"description": "Oferta vencida o con otro resultado final"},
    },
)
@limiter.limit(lambda: settings.limite_escritura, key_func=clave_usuario)
async def registrar_evento(
    request: Request,
    datos: EventoIAIn,
    usuario: Annotated[dict, Depends(require_permiso("ia:usar"))],
):
    try:
        resultado = await registrar_evento_cliente(
            get_db(),
            analisis_id=datos.analisis_id,
            evento=datos.evento,
            actor_id=usuario["_id"],
            secreto=settings.jwt_secret,
            motivo=datos.motivo,
        )
    except (OfertaIANoEncontrada, OfertaIAAjena) as exc:
        raise HTTPException(404, "Oferta de IA no encontrada") from exc
    except OfertaIAVencida as exc:
        raise HTTPException(409, "La oferta de IA ya venció") from exc
    except EventoIAConflictivo as exc:
        raise HTTPException(409, str(exc)) from exc
    return EventoIAOut(
        analisis_id=resultado.analisis_id,
        evento=resultado.evento,
        registrado=resultado.registrado,
        es_final=resultado.es_final,
    )


@router.post(
    "/duplicados/adhesiones",
    response_model=AdhesionOut,
    summary="Confirmar una coincidencia y adherirse al reporte existente",
    responses={
        400: {"description": "Identificador de coincidencia invalido"},
        401: {"description": "Autenticacion requerida"},
        403: {"description": "Falta un permiso requerido"},
        404: {"description": "Coincidencia inexistente, expirada o de otro usuario"},
        409: {"description": "El reporte dejo de admitir adhesiones"},
    },
)
@limiter.limit(lambda: settings.limite_escritura, key_func=clave_usuario)
async def adherirse_a_duplicado(
    request: Request,
    datos: ConfirmarAdhesionIn,
    usuario: Annotated[dict, Depends(require_permiso("ia:usar"))],
):
    if "incidencias:crear" not in usuario["_permisos"]:
        raise HTTPException(403, "Falta el permiso incidencias:crear")
    try:
        return await confirmar_adhesion(
            get_db(),
            coincidencia_id=datos.coincidencia_id,
            usuario_id=usuario["_id"],
            secreto=settings.jwt_secret,
        )
    except CoincidenciaNoEncontrada as exc:
        raise HTTPException(404, "Coincidencia no encontrada") from exc
    except CoincidenciaNoElegible as exc:
        raise HTTPException(409, "El reporte ya no admite adhesiones") from exc


@router.get(
    "/analisis/{analisis_id}",
    response_model=RespuestaIA,
    response_model_exclude_none=True,
    summary="Consultar un análisis temporal propio",
    responses={
        401: {"description": "Autenticación requerida"},
        403: {"description": "Falta el permiso ia:usar"},
        404: {"description": "Análisis inexistente, expirado o de otro usuario"},
        503: {"description": "Redis no disponible"},
    },
)
async def consultar_analisis(
    analisis_id: UUID,
    usuario: Annotated[dict, Depends(require_permiso("ia:usar"))],
):
    try:
        registro = await cargar_analisis(get_redis(), analisis_id, str(usuario["_id"]))
    except Exception as error:
        raise HTTPException(503, "El análisis temporal no está disponible") from error
    if registro is None:
        raise HTTPException(404, "Análisis no encontrado")
    return registro.respuesta


__all__ = ["router", "IAError"]
