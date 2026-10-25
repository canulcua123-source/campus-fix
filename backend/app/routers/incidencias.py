import asyncio
import json
import math
import re
import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from typing import Annotated, Any, Literal

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import UUID4, BaseModel, ConfigDict, Field, field_validator
from pymongo.errors import DuplicateKeyError

from app.core import storage
from app.core.config import settings
from app.core.db import get_db, get_redis
from app.core.limiter import clave_usuario, limiter
from app.core.security import filtro_alcance, permisos_del_usuario, require_permiso
from app.core.serial import a_json
from app.schemas.incidencia import (
    TRANSICIONES,
    Estado,
    IncidenciaIn,
    IncidenciaDetalleOut,
    Prioridad,
    SeguimientoIn,
    TagsIn,
)

router = APIRouter(prefix="/incidencias", tags=["incidencias"])

PREFIJOS = {"computo_redes": "RED", "infraestructura": "INF", "academico": "ACA"}
Categoria = Literal["computo_redes", "infraestructura", "academico"]
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
ZONA = ZoneInfo("America/Mexico_City")
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


async def generar_codigo(categoria: str, ahora: datetime) -> str:
    local = ahora.astimezone(ZONA)  # el "día" del folio es el del campus, no UTC
    clave = _clave_contador(categoria, local)
    redis = get_redis()
    n = await redis.incr(clave)
    await redis.expire(clave, 2 * 24 * 3600)
    return f"INC-{local:%Y}-{local:%m%d}-{PREFIJOS[categoria]}-{n:04d}"


async def _resincronizar_contador(categoria: str, ahora: datetime) -> None:
    """Si Redis perdió el contador, lo coloca en el último consecutivo guardado en MongoDB."""
    local = ahora.astimezone(ZONA)
    prefijo = f"INC-{local:%Y}-{local:%m%d}-{PREFIJOS[categoria]}-"
    ultimo = await get_db().incidencias_campus.find_one(
        {"codigo": {"$regex": f"^{re.escape(prefijo)}"}}, {"codigo": 1}, sort=[("codigo", -1)]
    )
    if ultimo:
        await get_redis().set(_clave_contador(categoria, local), int(ultimo["codigo"][-4:]), ex=2 * 24 * 3600)


@router.post("", status_code=201)
@limiter.limit(lambda: settings.limite_escritura, key_func=clave_usuario)
async def crear_incidencia(
    request: Request, datos: IncidenciaIn, usuario: Annotated[dict, Depends(require_permiso("incidencias:crear"))]
):
    ahora = datetime.now(timezone.utc)
    detalle = datos.detalle_especifico.model_dump(mode="json", exclude_none=True)
    categoria = detalle["categoria"]
    doc = {
        "schema_version": 1,
        "titulo": datos.titulo,
        "descripcion": datos.descripcion,
        "categoria": categoria,
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
        doc["ia_sugerencia"] = datos.ia_sugerencia.model_dump()
    for intento in range(3):
        doc["codigo"] = await generar_codigo(categoria, ahora)
        try:
            res = await get_db().incidencias_campus.insert_one(doc)
            break
        except DuplicateKeyError:
            doc.pop("_id", None)
            await _resincronizar_contador(categoria, ahora)
    else:
        raise HTTPException(409, "No fue posible generar un folio único; intenta de nuevo")
    return {"_id": str(res.inserted_id), "codigo": doc["codigo"], "estado": doc["estado"]}


@router.get("")
async def listar_incidencias(
    usuario: Annotated[dict, Depends(require_permiso("incidencias:ver"))],
    estado: Estado | None = None,
    categoria: Categoria | None = None,
    prioridad: Prioridad | None = None,
    edificio: Annotated[str | None, Query(max_length=60)] = None,
    limite: Annotated[int, Query(ge=1, le=100)] = 100,
):
    filtro: dict[str, Any] = {}
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
    origenes = [e for e, destinos in TRANSICIONES.items() if datos.estado_nuevo in destinos]
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
    if incidencia["estado"] == "cerrada":
        raise HTTPException(409, "La incidencia está cerrada")
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
        {"_id": incidencia["_id"], "estado": {"$ne": "cerrada"}, **filtro_alcance(usuario)},
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
    incidencia_id: str, datos: EvidenciaFirmaIn, usuario: Annotated[dict, Depends(require_permiso("evidencias:subir"))]
):
    inc = await _en_alcance(incidencia_id, usuario, {"codigo": 1, "evidencias_adjuntas.evidencia_id": 1})
    redis = get_redis()
    clave_dia = f"firmas:usuario:{usuario['_id']}:{datetime.now(timezone.utc):%Y-%m-%d}"
    if await redis.incr(clave_dia) > MAX_FIRMAS_DIA:
        raise HTTPException(429, f"Límite de {MAX_FIRMAS_DIA} archivos por día alcanzado")
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
    url = storage.url_subida(clave_staging, datos.tipo_mime, datos.peso_bytes)
    # El servidor recuerda lo que firmó: al registrar solo se acepta esta evidencia, con estos datos.
    pendiente = {
        "incidencia_id": str(inc["_id"]),
        "clave": clave,
        "clave_staging": clave_staging,
        "usuario_id": str(usuario["_id"]),
        **datos.model_dump(),
    }
    await redis.set(f"firma:{evidencia_id}", json.dumps(pendiente), ex=FIRMA_TTL)
    return {"evidencia_id": evidencia_id, "url_storage": clave, "upload_url": url, "expira_en": storage.EXPIRA_SEGUNDOS}


@router.post("/{incidencia_id}/evidencias", status_code=201)
async def registrar_evidencia(
    incidencia_id: str, datos: EvidenciaIn, usuario: Annotated[dict, Depends(require_permiso("evidencias:subir"))]
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
        tamano = await asyncio.to_thread(storage.tamano_objeto, pendiente["clave_staging"])
        if tamano is None or tamano != pendiente["peso_bytes"]:
            raise HTTPException(400, "El archivo no se subió o no coincide con lo firmado")
        # Copia a la ruta definitiva: la URL de subida (aún vigente) ya no puede reemplazar la evidencia.
        await asyncio.to_thread(storage.promover, pendiente["clave_staging"], pendiente["clave"])
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
    incidencia_id: str, evidencia_id: str, usuario: Annotated[dict, Depends(require_permiso("incidencias:ver"))]
):
    inc = await _en_alcance(incidencia_id, usuario, {"evidencias_adjuntas": 1})
    ev = next((e for e in inc.get("evidencias_adjuntas", []) if e.get("evidencia_id") == evidencia_id), None)
    if ev is None:
        raise HTTPException(404, "Evidencia no encontrada")
    url = storage.url_lectura(ev["url_storage"], ev.get("nombre_archivo", "evidencia"))
    return {"url": url, "expira_en": storage.EXPIRA_SEGUNDOS}
