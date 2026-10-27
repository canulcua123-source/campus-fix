"""Consulta administrativa de la bitácora de auditoría."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.db import get_db
from app.core.security import require_permiso
from app.core.serial import a_json
from app.schemas.auditoria import PaginaAuditoriaOut, RecursoAuditoria

router = APIRouter(prefix="/auditoria", tags=["auditoria"])

PROYECCION_AUDITORIA = {
    "actor_id": 1,
    "accion": 1,
    "recurso": 1,
    "recurso_id": 1,
    "antes": 1,
    "despues": 1,
    "fecha": 1,
}


@router.get(
    "",
    response_model=PaginaAuditoriaOut,
    response_model_exclude_none=True,
    summary="Consultar la bitácora administrativa",
    description=(
        "Solo el rol administrador puede consultar eventos de usuarios, roles, categorías y aulas. "
        "Los resultados se ordenan por fecha e identificador descendentes y admiten filtro por recurso."
    ),
    responses={
        400: {"description": "Parámetros de paginación o recurso inválidos"},
        401: {"description": "Autenticación requerida"},
        403: {"description": "Acceso exclusivo del administrador"},
    },
)
async def listar_auditoria(
    usuario: Annotated[dict, Depends(require_permiso("usuarios:gestionar"))],
    pagina: Annotated[int, Query(ge=1)] = 1,
    limite: Annotated[int, Query(ge=1, le=100)] = 20,
    recurso: RecursoAuditoria | None = None,
):
    if usuario.get("rol") != "admin":
        raise HTTPException(403, "La bitácora de auditoría es exclusiva del administrador")

    filtro = {"recurso": recurso} if recurso is not None else {}
    coleccion = get_db().auditoria
    total = await coleccion.count_documents(filtro)
    cursor = (
        coleccion.find(filtro, PROYECCION_AUDITORIA)
        .sort([("fecha", -1), ("_id", -1)])
        .skip((pagina - 1) * limite)
        .limit(limite)
    )
    resultados = [a_json(documento) async for documento in cursor]
    return {"pagina": pagina, "limite": limite, "total": total, "resultados": resultados}
