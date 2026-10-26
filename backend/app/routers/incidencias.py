import asyncio
import json
import math
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Literal

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from pydantic import UUID4, BaseModel, ConfigDict, Field, ValidationError, field_validator
from pymongo.errors import DuplicateKeyError

from app.core.cache_categorias import modelo_detalle_cacheado, obtener_definicion_cacheada
from app.core.config import settings
from app.core.db import get_db, get_redis
from app.core.errores import cabeceras_retry_after
from app.core.limiter import clave_usuario, limiter
from app.core.security import filtro_alcance, permisos_del_usuario, require_permiso
from app.core.serial import a_json
from app.core.storage import get_storage
from app.dominio.categorias import CATEGORIAS_SISTEMA
from app.dominio.detalle import DefinicionDetalleError
from app.dominio.estados import (
    AccionReportanteInvalida,
    VENTANA_RETIRO,
    ahora_utc,
    origenes_permitidos,
    retiro_en_ventana,
    validar_confirmacion_reportante,
    validar_reapertura_reportante,
)
from app.dominio.folio import fecha_local_campus, formatear_folio, prefijo_folio
from app.dominio.puertos import StorageNoDisponibleError, StoragePort
from app.schemas.incidencia import (
    AccionEstadoOut,
    ComentarioReportanteIn,
    ConfirmacionIn,
    Estado,
    IncidenciaIn,
    IncidenciaDetalleOut,
    Prioridad,
    SeguimientoIn,
    TagsIn,
    TomarIncidenciaIn,
    TomarIncidenciaOut,
)
from app.services.duplicados import actualizar_elegibilidad_huella

router = APIRouter(prefix="/incidencias", tags=["incidencias"])
_STORAGE_DIRECTO = get_storage()

TipoMime = Literal["image/jpeg", "image/png", "image/webp", "application/pdf"]
EXTENSIONES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf"}
MAX_EVIDENCIAS = 10
MAX_HISTORIAL = 200  # acota el arreglo embebido: se conservan las últimas 200 entradas ($slice)
MAX_HORAS = 1000  # tope de horas acumuladas por incidencia (evita contaminar la analítica)
MAX_FIRMAS_DIA = 50  # firmas de evidencia por usuario al día

# DECR que nunca baja de 0 y conserva el TTL de la clave
_DECR_SEGURO = """
local v = tonumber(redis.call('GET', KEYS[1]) or '0')
if v > 0 then redis.call('DECR', KEYS[1]) end
return v
"""
FIRMA_TTL = 600
PROYECCION_LISTA = {
    "codigo": 1,
    "titulo": 1,
    "categoria": 1,
    "estado": 1,
    "prioridad": 1,
    "ubicacion": 1,
    "tags": 1,
    "fecha_creacion": 1,
    "tecnico_asignado": 1,
}


def _oid(id_: str) -> ObjectId:
    if not ObjectId.is_valid(id_):
        raise HTTPException(400, "Identificador inválido")
    return ObjectId(id_)


async def _en_alcance(incidencia_id: str, usuario: dict, proyeccion: dict | None = None) -> dict:
    """Carga la incidencia solo si está dentro del alcance; fuera de alcance responde 404 (no revela que existe)."""
    doc = await get_db().incidencias_campus.find_one(
        {"_id": _oid(incidencia_id), **filtro_alcance(usuario)}, proyeccion
    )
    if doc is None:
        raise HTTPException(404, "Incidencia no encontrada")
    return doc


def _clave_contador(categoria: str, local: datetime) -> str:
    return f"contador:incidencias:{local:%Y-%m-%d}:{categoria}"


async def generar_codigo(categoria: str, ahora: datetime, prefijo_categoria: str | None = None) -> str:
    local = fecha_local_campus(ahora)  # el "día" del folio es el del campus, no UTC
    clave = _clave_contador(categoria, local)
    redis = get_redis()
    n = await redis.incr(clave)
    await redis.expire(clave, 2 * 24 * 3600)
    return formatear_folio(categoria, n, ahora, prefijo_categoria)


async def _resincronizar_contador(
    categoria: str,
    ahora: datetime,
    prefijo_categoria: str | None = None,
) -> None:
    """Si Redis perdió el contador, lo coloca en el último consecutivo guardado en MongoDB."""
    local = fecha_local_campus(ahora)
    prefijo = prefijo_folio(categoria, ahora, prefijo_categoria)
    ultimo = await get_db().incidencias_campus.find_one(
        {"codigo": {"$regex": f"^{re.escape(prefijo)}"}}, {"codigo": 1}, sort=[("codigo", -1)]
    )
    if ultimo:
        await get_redis().set(_clave_contador(categoria, local), int(ultimo["codigo"][-4:]), ex=2 * 24 * 3600)


async def _categoria_activa(clave: str) -> dict[str, Any]:
    categoria = await get_db().categorias.find_one(
        {"clave": clave, "activa": True},
        {"_id": 0, "clave": 1, "version": 1, "prefijo": 1, "area_responsable": 1, "sistema": 1},
    )
    if categoria is None:
        raise HTTPException(400, "La categoría indicada no existe o está inactiva")
    if type(categoria.get("version")) is not int or categoria["version"] < 1:
        raise HTTPException(503, "La definición de la categoría no está disponible")
    if not isinstance(categoria.get("prefijo"), str) or re.fullmatch(r"[A-Z]{3}", categoria["prefijo"]) is None:
        raise HTTPException(503, "La definición de la categoría no está disponible")
    return categoria


def _errores_detalle(exc: ValidationError) -> list[dict[str, Any]]:
    errores: list[dict[str, Any]] = []
    for error in exc.errors(include_url=False, include_context=False, include_input=False):
        errores.append({**error, "loc": ("body", "detalle_especifico", *error.get("loc", ()))})
    return errores


async def _validar_detalle(datos: IncidenciaIn) -> tuple[dict[str, Any], dict[str, Any]]:
    bruto = datos.detalle_especifico.model_dump(mode="json", exclude_none=True)
    clave = bruto["categoria"]
    categoria = await _categoria_activa(clave)
    if clave in CATEGORIAS_SISTEMA:
        return bruto, categoria

    async def cargar_campos() -> list[dict[str, Any]] | None:
        actual = await get_db().categorias.find_one(
            {"clave": clave, "version": categoria["version"], "activa": True},
            {"_id": 0, "campos": 1},
        )
        return actual.get("campos") if actual is not None else None

    try:
        definicion = await obtener_definicion_cacheada(
            clave,
            categoria["version"],
            cargar=cargar_campos,
        )
        if definicion is None:
            raise HTTPException(409, "La categoría cambió; intenta de nuevo")
        modelo = modelo_detalle_cacheado(definicion)
        detalle = modelo.model_validate(bruto).model_dump(mode="json", exclude_unset=True, exclude_none=True)
    except ValidationError as exc:
        raise RequestValidationError(_errores_detalle(exc)) from exc
    except DefinicionDetalleError as exc:
        raise HTTPException(503, "La definición de la categoría no está disponible") from exc
    return detalle, categoria


@router.post(
    "",
    status_code=201,
    summary="Crear una incidencia",
    description=(
        "Las tres categorías del sistema conservan sus contratos estáticos. "
        "Para una categoría personalizada activa, detalle_especifico se valida "
        "estrictamente contra la versión vigente de su definición en el catálogo."
    ),
    responses={
        400: {"description": "Campos comunes o detalle_especifico inválidos"},
        401: {"description": "Autenticación requerida"},
        403: {"description": "Falta el permiso incidencias:crear"},
        409: {"description": "La categoría cambió o no fue posible generar un folio único"},
    },
)
@limiter.limit(lambda: settings.limite_escritura, key_func=clave_usuario)
async def crear_incidencia(
    request: Request, datos: IncidenciaIn, usuario: Annotated[dict, Depends(require_permiso("incidencias:crear"))]
):
    ahora = datetime.now(timezone.utc)
    detalle, definicion_categoria = await _validar_detalle(datos)
    categoria = detalle["categoria"]
    doc = {
        "schema_version": 1,
        "titulo": datos.titulo,
        "descripcion": datos.descripcion,
        "categoria": categoria,
        "categoria_version": definicion_categoria["version"],
        "estado": "abierta",
        "prioridad": datos.prioridad,
        "ubicacion": datos.ubicacion.model_dump(exclude_none=True),
        "reportante": {"usuario_id": usuario["_id"], "nombre": usuario["nombre"]},
        "detalle_especifico": detalle,
        "tags": datos.tags,
        "evidencias_adjuntas": [],
        "horas_invertidas": 0,
        "historial_seguimiento": [
            {
                "fecha": ahora,
                "usuario_id": usuario["_id"],
                "estado_nuevo": "abierta",
                "comentario": "Incidencia creada",
                "horas": 0,
            }
        ],
        "fecha_creacion": ahora,
        "fecha_actualizacion": ahora,
    }
    if datos.ia_sugerencia is not None:
        doc["ia_sugerencia"] = datos.ia_sugerencia.model_dump(exclude_none=True)
    for intento in range(3):
        vigente = await get_db().categorias.find_one(
            {
                "clave": categoria,
                "version": definicion_categoria["version"],
                "prefijo": definicion_categoria["prefijo"],
                "activa": True,
            },
            {"_id": 1},
        )
        if vigente is None:
            raise HTTPException(409, "La categoría cambió; intenta de nuevo")
        prefijo_categoria = None if categoria in CATEGORIAS_SISTEMA else definicion_categoria["prefijo"]
        doc["codigo"] = await generar_codigo(categoria, ahora, prefijo_categoria)
        try:
            res = await get_db().incidencias_campus.insert_one(doc)
            break
        except DuplicateKeyError:
            doc.pop("_id", None)
            await _resincronizar_contador(categoria, ahora, prefijo_categoria)
    else:
        raise HTTPException(409, "No fue posible generar un folio único; intenta de nuevo")
    return {"_id": str(res.inserted_id), "codigo": doc["codigo"], "estado": doc["estado"]}


@router.get("")
async def listar_incidencias(
    usuario: Annotated[dict, Depends(require_permiso("incidencias:ver"))],
    estado: Estado | None = None,
    categoria: Annotated[
        str | None,
        Query(min_length=3, max_length=30, pattern=r"^[a-z][a-z0-9_]*$"),
    ] = None,
    prioridad: Prioridad | None = None,
    edificio: Annotated[str | None, Query(max_length=60)] = None,
    propias: Annotated[bool, Query(description="Solo las reportadas por el usuario en sesión")] = False,
    tecnico: Annotated[
        str | None,
        Query(pattern=r"^([0-9a-f]{24}|sin_asignar)$", description="Id del técnico asignado o `sin_asignar`"),
    ] = None,
    limite: Annotated[int, Query(ge=1, le=100)] = 100,
):
    filtro: dict[str, Any] = {}
    if propias:
        filtro["reportante.usuario_id"] = usuario["_id"]
    if tecnico == "sin_asignar":
        filtro["tecnico_asignado"] = {"$exists": False}
    elif tecnico is not None:
        filtro["tecnico_asignado.usuario_id"] = ObjectId(tecnico)
    for campo, valor in (
        ("estado", estado),
        ("categoria", categoria),
        ("prioridad", prioridad),
        ("ubicacion.edificio", edificio),
    ):
        if valor is not None:
            filtro[campo] = valor
    # $and: el filtro del cliente se suma al alcance; nunca lo reemplaza ni es reemplazado.
    cursor = (
        get_db()
        .incidencias_campus.find({"$and": [filtro, filtro_alcance(usuario)]}, PROYECCION_LISTA)
        .sort("fecha_creacion", -1)
        .limit(limite)
    )
    return [a_json(d) async for d in cursor]


@router.get("/buscar")
@limiter.limit(lambda: settings.limite_consulta_pesada)
async def buscar(
    request: Request,
    q: Annotated[str, Query(min_length=2, max_length=100)],
    usuario: Annotated[dict, Depends(require_permiso("incidencias:buscar"))],
):
    filtro = {"$text": {"$search": q}, **filtro_alcance(usuario)}
    proyeccion = {**PROYECCION_LISTA, "score": {"$meta": "textScore"}}
    cursor = get_db().incidencias_campus.find(filtro, proyeccion).sort([("score", {"$meta": "textScore"})]).limit(20)
    return [a_json(d) async for d in cursor]


@router.get("/{incidencia_id}", response_model=IncidenciaDetalleOut, response_model_exclude_none=True)
async def detalle(incidencia_id: str, usuario: Annotated[dict, Depends(require_permiso("incidencias:ver"))]):
    doc = await _en_alcance(incidencia_id, usuario)
    doc["puede_retirar"] = (
        doc.get("reportante", {}).get("usuario_id") == usuario["_id"]
        and doc.get("estado") == "abierta"
        and "tecnico_asignado" not in doc
        and retiro_en_ventana(doc.get("fecha_creacion"), ahora_utc())
    )
    historial = doc.get("historial_seguimiento", [])
    ids = list({entrada["usuario_id"] for entrada in historial})
    nombres = {}
    if ids:
        cursor = get_db().usuarios.find({"_id": {"$in": ids}}, {"nombre": 1}).limit(MAX_HISTORIAL)
        nombres = {autor["_id"]: autor["nombre"] async for autor in cursor}
    # Solo en la respuesta: no altera el historial almacenado ni expone el directorio.
    for entrada in historial:
        if entrada["usuario_id"] in nombres:
            entrada["autor_nombre"] = nombres[entrada["usuario_id"]]
    return a_json(doc)


def _entrada_historial(ahora: datetime, usuario: dict, estado: str, comentario: str) -> dict[str, Any]:
    return {
        "fecha": ahora,
        "usuario_id": usuario["_id"],
        "estado_nuevo": estado,
        "comentario": comentario,
        "horas": 0,
    }


def _push_historial(entrada: dict[str, Any]) -> dict[str, Any]:
    return {"$each": [entrada], "$slice": -MAX_HISTORIAL}


@router.post(
    "/{incidencia_id}/retirar",
    response_model=AccionEstadoOut,
    summary="Retirar una incidencia propia",
    description=(
        "El reportante propietario puede retirar su incidencia durante los primeros 15 minutos, "
        "mientras siga abierta y sin técnico asignado. Todas las condiciones se verifican en una "
        "única actualización atómica."
    ),
    responses={
        400: {"description": "Identificador inválido"},
        401: {"description": "Autenticación requerida"},
        403: {"description": "Falta el permiso incidencias:ver"},
        404: {"description": "Incidencia inexistente o fuera de alcance"},
        409: {"description": "Incidencia no elegible o conflicto concurrente"},
    },
)
@limiter.limit(lambda: settings.limite_escritura, key_func=clave_usuario)
async def retirar_incidencia(
    request: Request,
    incidencia_id: str,
    usuario: Annotated[dict, Depends(require_permiso("incidencias:ver"))],
):
    ahora = ahora_utc()
    res = await get_db().incidencias_campus.update_one(
        {
            "$and": [
                {
                    "_id": _oid(incidencia_id),
                    "reportante.usuario_id": usuario["_id"],
                    "estado": "abierta",
                    "tecnico_asignado": {"$exists": False},
                    "fecha_creacion": {
                        "$type": "date",
                        "$gte": ahora - VENTANA_RETIRO,
                        "$lte": ahora,
                    },
                },
                filtro_alcance(usuario),
            ]
        },
        {
            "$set": {"estado": "retirada", "fecha_actualizacion": ahora},
            "$push": {
                "historial_seguimiento": _push_historial(
                    _entrada_historial(ahora, usuario, "retirada", "Reporte retirado por su reportante")
                )
            },
        },
    )
    if res.matched_count == 0:
        actual = await _en_alcance(incidencia_id, usuario, {"reportante.usuario_id": 1})
        if actual.get("reportante", {}).get("usuario_id") != usuario["_id"]:
            raise HTTPException(404, "Incidencia no encontrada")
        raise HTTPException(409, "La incidencia ya no puede retirarse")
    await actualizar_elegibilidad_huella(get_db(), _oid(incidencia_id), "retirada")
    return {"ok": True, "estado": "retirada"}


async def _diagnosticar_accion_reportante(
    incidencia_id: str,
    usuario: dict,
    accion: Literal["confirmar", "reabrir", "comentar"],
    ahora: datetime,
) -> None:
    actual = await _en_alcance(
        incidencia_id,
        usuario,
        {"estado": 1, "fecha_resolucion": 1, "reportante.usuario_id": 1},
    )
    if actual.get("reportante", {}).get("usuario_id") != usuario["_id"]:
        raise HTTPException(403, "Solo el reportante propietario puede realizar esta acción")
    try:
        if accion == "confirmar":
            validar_confirmacion_reportante(actual["estado"])
        elif accion == "reabrir":
            validar_reapertura_reportante(actual["estado"], actual.get("fecha_resolucion"), ahora)
        elif actual["estado"] != "en_espera":
            raise AccionReportanteInvalida("Solo se puede comentar una incidencia en espera")
    except AccionReportanteInvalida as exc:
        raise HTTPException(409, str(exc)) from exc
    raise HTTPException(409, "La incidencia cambió; intenta de nuevo")


@router.post(
    "/{incidencia_id}/confirmacion",
    response_model=AccionEstadoOut,
    summary="Confirmar o reabrir una incidencia resuelta",
    description=(
        "El reportante propietario confirma la resolución para cerrar la incidencia o solicita "
        "su reapertura dentro de los siete días siguientes. La validación de estado, propiedad, "
        "alcance y plazo forma parte de una actualización atómica."
    ),
    responses={
        400: {"description": "Identificador, acción o comentario inválido"},
        401: {"description": "Autenticación requerida"},
        403: {"description": "Falta el permiso o el usuario no es el reportante propietario"},
        404: {"description": "Incidencia inexistente o fuera de alcance"},
        409: {"description": "Estado incompatible, plazo vencido o conflicto concurrente"},
    },
)
@limiter.limit(lambda: settings.limite_escritura, key_func=clave_usuario)
async def confirmar_o_reabrir(
    request: Request,
    incidencia_id: str,
    datos: ConfirmacionIn,
    usuario: Annotated[dict, Depends(require_permiso("incidencias:ver"))],
):
    ahora = datetime.now(timezone.utc)
    oid = _oid(incidencia_id)
    propietario = {"reportante.usuario_id": usuario["_id"]}
    condiciones: list[dict[str, Any]] = [
        {"_id": oid, "estado": "resuelta"},
        filtro_alcance(usuario),
        propietario,
    ]
    if datos.accion == "confirmar":
        estado_resultante = "cerrada"
        comentario = datos.comentario or "Resolución confirmada por el reportante"
        update: dict[str, Any] = {
            "$set": {"estado": estado_resultante, "fecha_actualizacion": ahora},
            "$push": {
                "historial_seguimiento": _push_historial(
                    _entrada_historial(ahora, usuario, estado_resultante, comentario)
                )
            },
        }
    else:
        estado_resultante = "abierta"
        comentario = datos.comentario or "Reapertura solicitada por el reportante"
        condiciones.append(
            {
                "fecha_resolucion": {
                    "$gte": ahora - timedelta(days=7),
                    "$lte": ahora,
                }
            }
        )
        update = {
            "$set": {"estado": estado_resultante, "fecha_actualizacion": ahora},
            "$unset": {"fecha_resolucion": ""},
            "$push": {
                "historial_seguimiento": _push_historial(
                    _entrada_historial(ahora, usuario, estado_resultante, comentario)
                )
            },
        }
    res = await get_db().incidencias_campus.update_one({"$and": condiciones}, update)
    if res.matched_count == 0:
        await _diagnosticar_accion_reportante(incidencia_id, usuario, datos.accion, ahora)
    await actualizar_elegibilidad_huella(get_db(), oid, estado_resultante)
    return {"ok": True, "estado": estado_resultante}


@router.post(
    "/{incidencia_id}/comentarios",
    response_model=AccionEstadoOut,
    summary="Agregar informacion del reportante durante una espera",
    description=(
        "El reportante propietario agrega información únicamente mientras la incidencia está "
        "en espera. Solo se actualizan la fecha y el historial, sin cambiar estado ni horas."
    ),
    responses={
        400: {"description": "Identificador o comentario inválido"},
        401: {"description": "Autenticación requerida"},
        403: {"description": "Falta el permiso o el usuario no es el reportante propietario"},
        404: {"description": "Incidencia inexistente o fuera de alcance"},
        409: {"description": "La incidencia no esta en espera o cambio concurrentemente"},
    },
)
@limiter.limit(lambda: settings.limite_escritura, key_func=clave_usuario)
async def comentar_en_espera(
    request: Request,
    incidencia_id: str,
    datos: ComentarioReportanteIn,
    usuario: Annotated[dict, Depends(require_permiso("incidencias:ver"))],
):
    ahora = datetime.now(timezone.utc)
    res = await get_db().incidencias_campus.update_one(
        {
            "$and": [
                {"_id": _oid(incidencia_id), "estado": "en_espera"},
                filtro_alcance(usuario),
                {"reportante.usuario_id": usuario["_id"]},
            ]
        },
        {
            "$set": {"fecha_actualizacion": ahora},
            "$push": {
                "historial_seguimiento": _push_historial(
                    _entrada_historial(ahora, usuario, "en_espera", datos.comentario)
                )
            },
        },
    )
    if res.matched_count == 0:
        await _diagnosticar_accion_reportante(incidencia_id, usuario, "comentar", ahora)
    return {"ok": True, "estado": "en_espera"}


@router.post(
    "/{incidencia_id}/tomar",
    response_model=TomarIncidenciaOut,
    summary="Autoasignarse una incidencia disponible",
    description=(
        "Un técnico toma una incidencia de su área que aún no tiene técnico. Solo son elegibles "
        "los estados abierta, en_proceso y en_espera; la asignación y el historial se guardan "
        "atómicamente sin cambiar el estado."
    ),
    responses={
        400: {"description": "Identificador inválido"},
        401: {"description": "Autenticación requerida"},
        403: {"description": "Falta el permiso o el actor no es un técnico elegible"},
        404: {"description": "Incidencia inexistente o fuera del área autorizada"},
        409: {"description": "Incidencia ya tomada, terminal o conflicto concurrente"},
    },
)
@limiter.limit(lambda: settings.limite_escritura, key_func=clave_usuario)
async def tomar_incidencia(
    request: Request,
    incidencia_id: str,
    usuario: Annotated[dict, Depends(require_permiso("seguimiento:registrar"))],
    datos: TomarIncidenciaIn | None = None,
):
    if usuario.get("rol") != "tecnico":
        raise HTTPException(403, "Solo un técnico puede tomar incidencias")
    ahora = datetime.now(timezone.utc)
    estados_elegibles = ["abierta", "en_proceso", "en_espera"]
    tecnico = {"usuario_id": usuario["_id"], "nombre": usuario["nombre"]}
    oid = _oid(incidencia_id)
    actual = await _en_alcance(incidencia_id, usuario, {"estado": 1})
    estado = actual["estado"]
    res = await get_db().incidencias_campus.update_one(
        {
            "$and": [
                {"_id": oid, "estado": estado, "tecnico_asignado": {"$exists": False}},
                {"estado": {"$in": estados_elegibles}},
                filtro_alcance(usuario),
            ]
        },
        {
            "$set": {"tecnico_asignado": tecnico, "fecha_actualizacion": ahora},
            "$push": {
                "historial_seguimiento": _push_historial(
                    _entrada_historial(ahora, usuario, estado, f"Incidencia tomada por {usuario['nombre']}")
                )
            },
        },
    )
    if res.matched_count == 0:
        await _en_alcance(incidencia_id, usuario, {"_id": 1})
        raise HTTPException(409, "La incidencia no está disponible para autoasignación")
    return {
        "ok": True,
        "estado": estado,
        "tecnico_asignado": {"usuario_id": str(usuario["_id"]), "nombre": usuario["nombre"]},
    }


@router.patch("/{incidencia_id}/seguimiento")
@limiter.limit(lambda: settings.limite_escritura, key_func=clave_usuario)
async def registrar_seguimiento(
    request: Request,
    incidencia_id: str,
    datos: SeguimientoIn,
    usuario: Annotated[dict, Depends(require_permiso("seguimiento:registrar"))],
):
    if datos.estado_nuevo == "cerrada" and "incidencias:asignar" not in usuario["_permisos"]:
        raise HTTPException(403, "Solo un coordinador puede cerrar incidencias")
    origenes = origenes_permitidos(datos.estado_nuevo)
    ahora = datetime.now(timezone.utc)
    sets: dict[str, Any] = {"estado": datos.estado_nuevo, "fecha_actualizacion": ahora}
    update: dict[str, Any] = {
        "$set": sets,
        "$push": {
            "historial_seguimiento": {
                "$each": [
                    {
                        "fecha": ahora,
                        "usuario_id": usuario["_id"],
                        "estado_nuevo": datos.estado_nuevo,
                        "comentario": datos.comentario,
                        "horas": datos.horas,
                    }
                ],
                "$slice": -MAX_HISTORIAL,
            }
        },
        "$inc": {"horas_invertidas": datos.horas},
    }
    if datos.estado_nuevo == "resuelta":
        sets["fecha_resolucion"] = ahora
    elif datos.estado_nuevo == "en_proceso":
        update["$unset"] = {"fecha_resolucion": ""}  # reapertura
    oid = _oid(incidencia_id)
    # El filtro por estado de origen hace atómica la validación de la transición.
    condiciones: list[dict[str, Any]] = [
        {"_id": oid, "estado": {"$in": origenes}, "horas_invertidas": {"$lte": MAX_HORAS - datos.horas}},
        filtro_alcance(usuario),
    ]
    asigna = "incidencias:asignar" in usuario["_permisos"]
    if not asigna:
        # Si ya tiene técnico asignado, solo ese técnico (o un coordinador) le da seguimiento.
        condiciones.append(
            {"$or": [{"tecnico_asignado": {"$exists": False}}, {"tecnico_asignado.usuario_id": usuario["_id"]}]}
        )
    filtro = {"$and": condiciones}
    res = await get_db().incidencias_campus.update_one(filtro, update)
    if res.matched_count == 0:
        actual = await _en_alcance(
            incidencia_id, usuario, {"tecnico_asignado": 1, "historial_seguimiento": {"$slice": -1}}
        )
        asignado = actual.get("tecnico_asignado", {}).get("usuario_id")
        if not asigna and asignado is not None and asignado != usuario["_id"]:
            raise HTTPException(403, "La incidencia está asignada a otro técnico")
        raise HTTPException(409, "Transición de estado no permitida")
    await actualizar_elegibilidad_huella(get_db(), oid, datos.estado_nuevo)
    return {"ok": True, "estado": datos.estado_nuevo}


@router.post("/{incidencia_id}/tags")
async def agregar_tags(
    incidencia_id: str, datos: TagsIn, usuario: Annotated[dict, Depends(require_permiso("tags:gestionar"))]
):
    res = await get_db().incidencias_campus.update_one(
        {"_id": _oid(incidencia_id), **filtro_alcance(usuario)},
        {"$addToSet": {"tags": {"$each": datos.tags}}, "$set": {"fecha_actualizacion": datetime.now(timezone.utc)}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Incidencia no encontrada")
    return {"ok": True}


@router.delete("/{incidencia_id}/tags")
async def quitar_tags(
    incidencia_id: str, datos: TagsIn, usuario: Annotated[dict, Depends(require_permiso("tags:gestionar"))]
):
    res = await get_db().incidencias_campus.update_one(
        {"_id": _oid(incidencia_id), **filtro_alcance(usuario)},
        {"$pull": {"tags": {"$in": datos.tags}}, "$set": {"fecha_actualizacion": datetime.now(timezone.utc)}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Incidencia no encontrada")
    return {"ok": True}


class AsignacionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tecnico_id: str = Field(min_length=24, max_length=24)


@router.patch("/{incidencia_id}/asignacion")
async def asignar(
    incidencia_id: str, datos: AsignacionIn, usuario: Annotated[dict, Depends(require_permiso("incidencias:asignar"))]
):
    incidencia = await _en_alcance(incidencia_id, usuario, {"estado": 1})
    if incidencia["estado"] in {"cerrada", "retirada"}:
        raise HTTPException(409, "La incidencia no admite asignación")
    no_valido = HTTPException(400, "Técnico no válido para esta incidencia")
    tecnico = await get_db().usuarios.find_one({"_id": _oid(datos.tecnico_id), "activo": {"$ne": False}})
    if tecnico is None:
        raise no_valido
    info = await permisos_del_usuario(tecnico)
    if "seguimiento:registrar" not in info["permisos"]:
        raise no_valido
    # La incidencia debe quedar dentro del alcance del técnico, si no nunca la vería.
    tecnico["_alcance"] = info["alcance"]
    if not await get_db().incidencias_campus.count_documents({"_id": incidencia["_id"], **filtro_alcance(tecnico)}):
        raise no_valido
    ahora = datetime.now(timezone.utc)
    res = await get_db().incidencias_campus.update_one(
        {"_id": incidencia["_id"], "estado": incidencia["estado"], **filtro_alcance(usuario)},
        {
            "$set": {
                "tecnico_asignado": {"usuario_id": tecnico["_id"], "nombre": tecnico["nombre"]},
                "fecha_actualizacion": ahora,
            },
            "$push": {
                "historial_seguimiento": {
                    "$each": [
                        {
                            "fecha": ahora,
                            "usuario_id": usuario["_id"],
                            "tipo": "asignacion",
                            "estado_nuevo": incidencia["estado"],
                            "comentario": f"Asignada a {tecnico['nombre']}",
                            "horas": 0,
                        }
                    ],
                    "$slice": -MAX_HISTORIAL,
                }
            },
        },
    )
    if res.matched_count == 0:
        raise HTTPException(409, "La incidencia cambió de estado; intenta de nuevo")
    return {"ok": True, "tecnico_asignado": {"usuario_id": str(tecnico["_id"]), "nombre": tecnico["nombre"]}}


MAX_BYTES_EVIDENCIA = 10 * 1024 * 1024


class EvidenciaFirmaIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nombre_archivo: str = Field(min_length=1, max_length=120, pattern=r"^[^/\\]+$")
    tipo_mime: TipoMime
    peso_bytes: int = Field(ge=1, le=MAX_BYTES_EVIDENCIA)

    @field_validator("nombre_archivo")
    @classmethod
    def _sin_rutas(cls, v: str) -> str:
        if ".." in v:
            raise ValueError("nombre_archivo no puede contener '..'")
        return v


class EvidenciaIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    evidencia_id: UUID4


async def _liberar_cupo(incidencia_oid: ObjectId, usuario_oid: ObjectId) -> None:
    redis = get_redis()
    clave = f"firmas:pendientes:{incidencia_oid}"
    await redis.eval(_DECR_SEGURO, 1, clave)
    await redis.eval(_DECR_SEGURO, 1, f"{clave}:{usuario_oid}")


def _clave(codigo: str, evidencia_id: str, tipo_mime: str) -> str:
    return f"evidencias/{codigo}/{evidencia_id}.{EXTENSIONES[tipo_mime]}"


@router.post("/{incidencia_id}/evidencias/firma")
async def firmar_evidencia(
    incidencia_id: str,
    datos: EvidenciaFirmaIn,
    usuario: Annotated[dict, Depends(require_permiso("evidencias:subir"))],
    almacenamiento: Annotated[StoragePort, Depends(get_storage)] = _STORAGE_DIRECTO,
):
    inc = await _en_alcance(incidencia_id, usuario, {"codigo": 1, "evidencias_adjuntas.evidencia_id": 1})
    redis = get_redis()
    ahora = datetime.now(timezone.utc)
    clave_dia = f"firmas:usuario:{usuario['_id']}:{ahora:%Y-%m-%d}"
    if await redis.incr(clave_dia) > MAX_FIRMAS_DIA:
        reinicio = (ahora + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        segundos = max(0, math.ceil((reinicio - datetime.now(timezone.utc)).total_seconds()))
        raise HTTPException(
            429,
            f"Límite de {MAX_FIRMAS_DIA} archivos por día alcanzado",
            headers=cabeceras_retry_after(segundos),
        )
    await redis.expire(clave_dia, 2 * 24 * 3600)
    # Cupo: evidencias guardadas + firmas pendientes (10 min) no pueden pasar de MAX_EVIDENCIAS,
    # y un mismo usuario no puede acaparar más de la mitad de los lugares pendientes.
    clave_cupo = f"firmas:pendientes:{inc['_id']}"
    clave_cupo_usuario = f"{clave_cupo}:{usuario['_id']}"
    pendientes = await redis.incr(clave_cupo)
    propias = await redis.incr(clave_cupo_usuario)
    await redis.expire(clave_cupo, FIRMA_TTL)
    await redis.expire(clave_cupo_usuario, FIRMA_TTL)
    if len(inc.get("evidencias_adjuntas", [])) + pendientes > MAX_EVIDENCIAS or propias > MAX_EVIDENCIAS // 2:
        await _liberar_cupo(inc["_id"], usuario["_id"])
        raise HTTPException(409, f"Se alcanzó el límite de {MAX_EVIDENCIAS} evidencias")
    evidencia_id = str(uuid.uuid4())
    clave = _clave(inc["codigo"], evidencia_id, datos.tipo_mime)
    # Se sube a staging/: una regla de lifecycle borra ahí lo que nunca se registró (huérfanos).
    clave_staging = f"staging/{clave}"
    try:
        url = almacenamiento.url_subida(clave_staging, datos.tipo_mime, datos.peso_bytes)
    except StorageNoDisponibleError as exc:
        raise HTTPException(503, str(exc)) from exc
    # El servidor recuerda lo que firmó: al registrar solo se acepta esta evidencia, con estos datos.
    pendiente = {
        "incidencia_id": str(inc["_id"]),
        "clave": clave,
        "clave_staging": clave_staging,
        "usuario_id": str(usuario["_id"]),
        **datos.model_dump(),
    }
    await redis.set(f"firma:{evidencia_id}", json.dumps(pendiente), ex=FIRMA_TTL)
    return {
        "evidencia_id": evidencia_id,
        "url_storage": clave,
        "upload_url": url,
        "expira_en": almacenamiento.expira_segundos,
    }


@router.post("/{incidencia_id}/evidencias", status_code=201)
async def registrar_evidencia(
    incidencia_id: str,
    datos: EvidenciaIn,
    usuario: Annotated[dict, Depends(require_permiso("evidencias:subir"))],
    almacenamiento: Annotated[StoragePort, Depends(get_storage)] = _STORAGE_DIRECTO,
):
    inc = await _en_alcance(incidencia_id, usuario, {"_id": 1})
    evidencia_id = str(datos.evidencia_id)
    redis = get_redis()
    crudo = await redis.getdel(f"firma:{evidencia_id}")
    pendiente = json.loads(crudo) if crudo else None
    if not pendiente or pendiente["incidencia_id"] != str(inc["_id"]) or pendiente["usuario_id"] != str(usuario["_id"]):
        raise HTTPException(400, "La evidencia no fue firmada para esta incidencia o la firma expiró")
    await _liberar_cupo(inc["_id"], usuario["_id"])
    if settings.r2_verificar_subida:
        try:
            tamano = await asyncio.to_thread(almacenamiento.tamano_objeto, pendiente["clave_staging"])
        except StorageNoDisponibleError as exc:
            raise HTTPException(503, str(exc)) from exc
        if tamano is None or tamano != pendiente["peso_bytes"]:
            raise HTTPException(400, "El archivo no se subió o no coincide con lo firmado")
        # Copia a la ruta definitiva: la URL de subida (aún vigente) ya no puede reemplazar la evidencia.
        try:
            await asyncio.to_thread(almacenamiento.promover, pendiente["clave_staging"], pendiente["clave"])
        except StorageNoDisponibleError as exc:
            raise HTTPException(503, str(exc)) from exc
    ahora = datetime.now(timezone.utc)
    res = await get_db().incidencias_campus.update_one(
        {
            "_id": inc["_id"],
            f"evidencias_adjuntas.{MAX_EVIDENCIAS - 1}": {"$exists": False},
            "evidencias_adjuntas.evidencia_id": {"$ne": evidencia_id},
            **filtro_alcance(usuario),
        },
        {
            "$push": {
                "evidencias_adjuntas": {
                    "evidencia_id": evidencia_id,
                    "nombre_archivo": pendiente["nombre_archivo"],
                    "tipo_mime": pendiente["tipo_mime"],
                    "peso_kb": math.ceil(pendiente["peso_bytes"] / 1024),
                    "url_storage": pendiente["clave"],
                    "fecha_carga": ahora,
                    "subido_por": usuario["_id"],
                }
            },
            "$set": {"fecha_actualizacion": ahora},
        },
    )
    if res.matched_count == 0:
        raise HTTPException(409, f"Evidencia duplicada o límite de {MAX_EVIDENCIAS} alcanzado")
    return {"ok": True, "evidencia_id": evidencia_id}


@router.get("/{incidencia_id}/evidencias/{evidencia_id}/url")
async def url_evidencia(
    incidencia_id: str,
    evidencia_id: str,
    usuario: Annotated[dict, Depends(require_permiso("incidencias:ver"))],
    almacenamiento: Annotated[StoragePort, Depends(get_storage)] = _STORAGE_DIRECTO,
):
    inc = await _en_alcance(incidencia_id, usuario, {"evidencias_adjuntas": 1})
    ev = next((e for e in inc.get("evidencias_adjuntas", []) if e.get("evidencia_id") == evidencia_id), None)
    if ev is None:
        raise HTTPException(404, "Evidencia no encontrada")
    try:
        url = almacenamiento.url_lectura(ev["url_storage"], ev.get("nombre_archivo", "evidencia"))
    except StorageNoDisponibleError as exc:
        raise HTTPException(503, str(exc)) from exc
    return {"url": url, "expira_en": almacenamiento.expira_segundos}
