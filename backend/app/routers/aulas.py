"""Consulta pública autenticada del catálogo de aulas."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.core.security import require_permiso
from app.core.ubicacion import resolver_ubicacion
from app.schemas.aula import AulaResueltaOut

router = APIRouter(prefix="/aulas", tags=["aulas"])


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
