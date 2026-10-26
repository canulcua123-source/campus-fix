from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.core.auditoria import registrar_auditoria
from app.core.config import settings
from app.core.cache_categorias import invalidar_categoria
from app.core.db import get_db
from app.core.limiter import clave_usuario, limiter
from app.core.security import get_usuario_actual, require_permiso
from app.core.serial import a_json
from app.dominio.categorias import CATEGORIAS_SISTEMA, es_categoria_sistema, normalizar_clave_categoria
from app.schemas.categoria import CategoriaIn, CategoriaOut, CategoriaPatch

router = APIRouter(prefix="/categorias", tags=["categorias"])


@router.get(
    "", response_model=list[CategoriaOut], response_model_exclude_none=True, summary="Listar categorías activas"
)
async def listar_categorias(_: Annotated[dict, Depends(get_usuario_actual)]):
    docs = [c async for c in get_db().categorias.find({"activa": True}).sort("clave", 1)]
    return a_json(docs)


async def _validar_prefijo_disponible(prefijo: str, excepto: str | None = None) -> None:
    filtro: dict[str, Any] = {"prefijo": prefijo}
    if excepto is not None:
        filtro["clave"] = {"$ne": excepto}
    if await get_db().categorias.find_one(filtro, {"_id": 1}):
        raise HTTPException(409, "Ya existe una categoría con ese prefijo")


@router.post(
    "",
    status_code=201,
    response_model=CategoriaOut,
    response_model_exclude_none=True,
    summary="Crear una categoría personalizada",
    description="Requiere el permiso categorias:gestionar. La categoría queda activa y con versión 1.",
    responses={
        400: {"description": "Definición de categoría inválida"},
        401: {"description": "Autenticación requerida"},
        403: {"description": "Falta el permiso categorias:gestionar"},
        409: {"description": "Clave o prefijo duplicado"},
    },
)
@limiter.limit(lambda: settings.limite_escritura, key_func=clave_usuario)
async def crear_categoria(
    request: Request,
    datos: CategoriaIn,
    usuario: Annotated[dict, Depends(require_permiso("categorias:gestionar"))],
):
    await _validar_prefijo_disponible(datos.prefijo)
    ahora = datetime.now(timezone.utc)
    doc = {
        **datos.model_dump(exclude_none=True),
        "version": 1,
        "activa": True,
        "sistema": False,
        "fecha_creacion": ahora,
        "fecha_actualizacion": ahora,
    }
    try:
        resultado = await get_db().categorias.insert_one(doc)
    except DuplicateKeyError as exc:
        raise HTTPException(409, "Ya existe una categoría con esa clave") from exc
    doc["_id"] = resultado.inserted_id
    await invalidar_categoria(datos.clave, 1)
    await registrar_auditoria(
        actor=usuario,
        accion="crear",
        recurso="categorias",
        recurso_id=datos.clave,
        despues=doc,
    )
    return a_json(doc)


@router.patch(
    "/{clave}",
    response_model=CategoriaOut,
    response_model_exclude_none=True,
    summary="Editar o desactivar una categoría",
    description=(
        "Requiere categorias:gestionar. Cambiar campos incrementa la versión; "
        "activa=false desactiva únicamente categorías personalizadas."
    ),
    responses={
        400: {"description": "Cambio inválido o vacío"},
        401: {"description": "Autenticación requerida"},
        403: {"description": "Falta el permiso categorias:gestionar"},
        404: {"description": "Categoría inexistente"},
        409: {"description": "Categoría protegida, duplicado o edición concurrente"},
    },
)
@limiter.limit(lambda: settings.limite_escritura, key_func=clave_usuario)
async def editar_categoria(
    request: Request,
    clave: str,
    datos: CategoriaPatch,
    usuario: Annotated[dict, Depends(require_permiso("categorias:gestionar"))],
):
    try:
        clave_normalizada = normalizar_clave_categoria(clave)
    except ValueError as exc:
        raise HTTPException(400, "Clave de categoría inválida") from exc

    coleccion = get_db().categorias
    actual = await coleccion.find_one({"clave": clave_normalizada})
    if actual is None:
        raise HTTPException(404, "Categoría no encontrada")

    cambios = datos.model_dump(exclude_unset=True, exclude_none=True)
    protegida = es_categoria_sistema(actual["clave"], actual.get("sistema", False))
    if protegida and (cambios.get("activa") is False or {"prefijo", "campos"} & cambios.keys()):
        raise HTTPException(409, "La categoría del sistema no admite ese cambio")

    if "prefijo" in cambios and cambios["prefijo"] != actual["prefijo"]:
        await _validar_prefijo_disponible(cambios["prefijo"], clave_normalizada)

    cambios = {campo: valor for campo, valor in cambios.items() if actual.get(campo) != valor}
    if not cambios:
        raise HTTPException(400, "No hay cambios")

    cambia_campos = "campos" in cambios
    cambios["fecha_actualizacion"] = datetime.now(timezone.utc)
    version_actual = actual.get("version", 1)
    condiciones: list[dict[str, Any]] = [
        {"clave": clave_normalizada},
        {"version": version_actual},
    ]
    if datos.activa is False:
        condiciones.extend(
            [
                {"clave": {"$nin": sorted(CATEGORIAS_SISTEMA)}},
                {"sistema": {"$ne": True}},
            ]
        )
    actualizacion: dict[str, Any] = {"$set": cambios}
    if cambia_campos:
        actualizacion["$inc"] = {"version": 1}

    try:
        actualizado = await coleccion.find_one_and_update(
            {"$and": condiciones},
            actualizacion,
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError as exc:
        raise HTTPException(409, "La actualización entra en conflicto con otra categoría") from exc
    if actualizado is None:
        existente = await coleccion.find_one({"clave": clave_normalizada}, {"_id": 1})
        if existente is None:
            raise HTTPException(404, "Categoría no encontrada")
        raise HTTPException(409, "La categoría cambió; intenta de nuevo")
    await invalidar_categoria(clave_normalizada, version_actual, actualizado["version"])
    await registrar_auditoria(
        actor=usuario,
        accion="editar",
        recurso="categorias",
        recurso_id=clave_normalizada,
        antes=actual,
        despues=actualizado,
    )
    return a_json(actualizado)
