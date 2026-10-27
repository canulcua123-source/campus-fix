"""Consulta pública autenticada del catálogo de aulas."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.core.db import get_db
from app.core.security import require_permiso
from app.core.ubicacion import resolver_ubicacion
from app.schemas.aula import AulaResueltaOut, EdificioCatalogoOut, UbicacionAulaOut

router = APIRouter(prefix="/aulas", tags=["aulas"])

# Tope del catálogo en una sola respuesta (solo lectura, uso administrativo).
MAX_AULAS_CATALOGO = 2000


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
        .aulas.find({}, {"_id": 0, "id_publico": 1, "edificio": 1, "piso": 1, "aula": 1, "activa": 1})
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
