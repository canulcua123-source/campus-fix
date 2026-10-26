from typing import Annotated

from fastapi import APIRouter, Depends, Form, HTTPException, Request, UploadFile

from datetime import datetime, timezone

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
from app.schemas.ia import AnalisisImagen, EventoIAIn, EventoIAOut
from app.services.ia import IAError, analizar_imagen
from app.services.ia_eventos import (
    EventoIAConflictivo,
    OfertaIAAjena,
    OfertaIANoEncontrada,
    OfertaIAVencida,
    registrar_evento_cliente,
)
from app.services.duplicados import (
    CoincidenciaNoElegible,
    CoincidenciaNoEncontrada,
    confirmar_adhesion,
)

router = APIRouter(prefix="/ia", tags=["ia"])


@router.post(
    "/analizar-imagen",
    response_model=AnalisisImagen,
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
):
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
    if not settings.ia_habilitada:
        raise HTTPException(503, "El análisis con IA está deshabilitado")
    # Cupo diario por usuario: cada análisis tiene costo.
    clave = f"ia:uso:{usuario['_id']}:{datetime.now(timezone.utc):%Y-%m-%d}"
    usos = await get_redis().incr(clave)
    await get_redis().expire(clave, 2 * 24 * 3600)
    if usos > settings.ia_limite_diario:
        raise HTTPException(429, f"Alcanzaste el límite de {settings.ia_limite_diario} análisis por día")
    clave_global = f"ia:uso:global:{datetime.now(timezone.utc):%Y-%m-%d}"
    if await get_redis().incr(clave_global) > settings.ia_limite_global_diario:
        raise HTTPException(503, "El análisis con IA no está disponible por hoy")
    await get_redis().expire(clave_global, 2 * 24 * 3600)
    try:
        return await analizar_imagen(validada.datos, validada.tipo_mime, contexto)
    except Exception as e:  # IAError, errores de red/API, JSON inválido
        raise HTTPException(503, "No fue posible analizar la imagen con IA") from e


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


__all__ = ["router", "IAError"]
