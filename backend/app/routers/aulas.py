"""Catálogo de aulas: consulta autenticada y alta/edición administrativa (RF-ADM-04)."""

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.core.auditoria import registrar_auditoria
from app.core.db import get_db
from app.core.security import require_permiso
from app.core.ubicacion import generar_id_aula, id_aula_valido, resolver_ubicacion
from app.schemas.aula import (
    AulaIn,
    AulaOut,
    AulaPatch,
    AulaResueltaOut,
    EdificioCatalogoOut,
    UbicacionAulaOut,
)

router = APIRouter(prefix="/aulas", tags=["aulas"])

# Tope del catálogo en una sola respuesta (solo lectura, uso administrativo).
MAX_AULAS_CATALOGO = 2000

PROYECCION_AULA = {"_id": 0, "id_publico": 1, "edificio": 1, "piso": 1, "aula": 1, "activa": 1}
MSG_AULA_DUPLICADA = "Ya existe un aula con ese edificio, piso y aula"
MSG_AULA_NO_ENCONTRADA = "Aula no encontrada"


@router.get(
    "",
    response_model=list[EdificioCatalogoOut],
    responses={
        401: {"description": "Autenticación requerida"},
        403: {"description": "Falta el permiso usuarios:gestionar"},
    },
)
async def listar_catalogo(
    _: Annotated[dict, Depends(require_permiso("usuarios:gestionar"))],
):
    """Catálogo de aulas agrupado por edificio (solo lectura)."""
    cursor = (
        get_db()
        .aulas.find({}, PROYECCION_AULA)
        .sort([("edificio", 1), ("piso", 1), ("aula", 1)])
        .limit(MAX_AULAS_CATALOGO)
    )
    edificios: dict[str, dict] = {}
    async for d in cursor:
        grupo = edificios.setdefault(
            d["edificio"], {"edificio": d["edificio"], "total_aulas": 0, "activas": 0, "pisos": [], "aulas": []}
        )
        grupo["total_aulas"] += 1
        grupo["activas"] += int(d["activa"])
        if d["piso"] not in grupo["pisos"]:
            grupo["pisos"].append(d["piso"])
        grupo["aulas"].append(
            {"id_publico": d["id_publico"], "piso": d["piso"], "aula": d["aula"], "activa": d["activa"]}
        )
    return list(edificios.values())


@router.post(
    "",
    status_code=201,
    response_model=AulaOut,
    responses={
        400: {"description": "Datos inválidos"},
        401: {"description": "Autenticación requerida"},
        403: {"description": "Falta el permiso usuarios:gestionar"},
        409: {"description": "Ya existe un aula con esa ubicación"},
    },
)
async def crear_aula(
    datos: AulaIn,
    usuario: Annotated[dict, Depends(require_permiso("usuarios:gestionar"))],
):
    """Alta manual de un aula; el servidor genera su `id_publico` opaco para el QR."""
    doc = {
        "id_publico": generar_id_aula(),
        **datos.model_dump(),
        "fecha_creacion": datetime.now(timezone.utc),
    }
    try:
        await get_db().aulas.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(409, MSG_AULA_DUPLICADA) from None
    await registrar_auditoria(
        actor=usuario,
        accion="crear",
        recurso="aulas",
        recurso_id=doc["id_publico"],
        despues=doc,
    )
    return {k: doc[k] for k in ("id_publico", "edificio", "piso", "aula", "activa")}


@router.get(
    "/ubicaciones",
    response_model=list[UbicacionAulaOut],
    responses={
        401: {"description": "Autenticación requerida"},
        403: {"description": "Falta el permiso incidencias:crear"},
    },
)
async def listar_ubicaciones(
    _: Annotated[dict, Depends(require_permiso("incidencias:crear"))],
):
    """Aulas activas para elegir la ubicación al reportar. Sin `id_publico`: los QR no se pueden enumerar."""
    cursor = (
        get_db()
        .aulas.find({"activa": True}, {"_id": 0, "edificio": 1, "piso": 1, "aula": 1})
        .sort([("edificio", 1), ("piso", 1), ("aula", 1)])
        .limit(MAX_AULAS_CATALOGO)
    )
    return [d async for d in cursor]


@router.get(
    "/{aula_id}",
    response_model=AulaResueltaOut,
    responses={
        401: {"description": "Autenticación requerida"},
        403: {"description": "Falta el permiso incidencias:crear"},
        404: {"description": "Identificador inexistente o inválido"},
    },
)
async def obtener_aula(
    aula_id: str,
    _: Annotated[dict, Depends(require_permiso("incidencias:crear"))],
):
    aula = await resolver_ubicacion(aula_id)
    if aula is None:
        # No distingue entre formato inválido e inexistente para evitar enumeración.
        raise HTTPException(404, "No se encontró el aula del código QR")
    return {
        "id_publico": aula["id_publico"],
        "ubicacion": {
            "edificio": aula["edificio"],
            "piso": aula["piso"],
            "aula": aula["aula"],
        },
    }


@router.patch(
    "/{id_publico}",
    response_model=AulaOut,
    responses={
        400: {"description": "Datos inválidos o sin cambios"},
        401: {"description": "Autenticación requerida"},
        403: {"description": "Falta el permiso usuarios:gestionar"},
        404: {"description": "Aula inexistente o identificador inválido"},
        409: {"description": "Ya existe un aula con esa ubicación"},
    },
)
async def editar_aula(
    id_publico: str,
    datos: AulaPatch,
    usuario: Annotated[dict, Depends(require_permiso("usuarios:gestionar"))],
):
    """Edita ubicación o estado de un aula. El `id_publico` (y por tanto su QR) no cambia."""
    if not id_aula_valido(id_publico):
        raise HTTPException(404, MSG_AULA_NO_ENCONTRADA)
    aulas = get_db().aulas
    actual = await aulas.find_one({"id_publico": id_publico}, PROYECCION_AULA)
    if actual is None:
        raise HTTPException(404, MSG_AULA_NO_ENCONTRADA)
    try:
        actualizado = await aulas.find_one_and_update(
            {"id_publico": id_publico},
            {"$set": datos.model_dump(exclude_none=True)},
            projection=PROYECCION_AULA,
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        raise HTTPException(409, MSG_AULA_DUPLICADA) from None
    if actualizado is None:
        raise HTTPException(404, MSG_AULA_NO_ENCONTRADA)
    await registrar_auditoria(
        actor=usuario,
        accion="editar",
        recurso="aulas",
        recurso_id=id_publico,
        antes=actual,
        despues=actualizado,
    )
    return actualizado
