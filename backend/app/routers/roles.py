from typing import Annotated

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pymongo.errors import DuplicateKeyError

from app.core.db import get_db
from app.core.security import puede_otorgar, require_permiso
from app.core.serial import a_json
from app.schemas.rol import RolIn, RolPatch

router = APIRouter(prefix="/roles", tags=["roles"])


@router.get("")
async def listar_roles(_: Annotated[dict, Depends(require_permiso("roles:gestionar"))]):
    roles = [r async for r in get_db().roles.find({}).sort("clave", 1)]
    for r in roles:
        r["_id"] = str(r["_id"])
    return roles


@router.post("", status_code=201)
async def crear_rol(datos: RolIn, usuario: Annotated[dict, Depends(require_permiso("roles:gestionar"))]):
    # Un usuario no puede otorgar permisos ni un alcance mayores a los suyos.
    if not puede_otorgar(usuario, datos.permisos, datos.alcance):
        raise HTTPException(403, "No puedes crear un rol con permisos o alcance mayores a los tuyos")
    doc = {**datos.model_dump(), "sistema": False}
    try:
        res = await get_db().roles.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(409, "Ya existe un rol con esa clave")
    doc["_id"] = str(res.inserted_id)
    return doc


def _oid(rol_id: str) -> ObjectId:
    if not ObjectId.is_valid(rol_id):
        raise HTTPException(400, "Identificador inválido")
    return ObjectId(rol_id)


async def _rol_editable(rol_id: str) -> tuple[ObjectId, dict]:
    oid = _oid(rol_id)
    rol = await get_db().roles.find_one({"_id": oid})
    if rol is None:
        raise HTTPException(404, "Rol no encontrado")
    if rol.get("sistema") is True:
        raise HTTPException(409, "Los roles del sistema son inmutables")
    return oid, rol


@router.patch("/{rol_id}")
async def editar_rol(
    rol_id: str, datos: RolPatch, usuario: Annotated[dict, Depends(require_permiso("roles:gestionar"))]
):
    oid, actual = await _rol_editable(rol_id)
    cambios = datos.model_dump(exclude_unset=True, exclude_none=True)
    if not cambios:
        raise HTTPException(400, "No hay cambios")
    permisos = cambios.get("permisos", actual["permisos"])
    alcance = cambios.get("alcance", actual["alcance"])
    if not puede_otorgar(usuario, permisos, alcance):
        raise HTTPException(403, "No puedes editar un rol con permisos o alcance mayores a los tuyos")
    if cambios.get("clave", actual["clave"]) != actual["clave"]:
        if await get_db().usuarios.find_one({"rol": actual["clave"]}, {"_id": 1}) is not None:
            raise HTTPException(409, "No se puede cambiar la clave de un rol asignado a usuarios")
    try:
        resultado = await get_db().roles.update_one({"_id": oid, "sistema": {"$ne": True}}, {"$set": cambios})
    except DuplicateKeyError:
        raise HTTPException(409, "Ya existe un rol con esa clave")
    if resultado.matched_count == 0:
        raise HTTPException(409, "Los roles del sistema son inmutables")
    return a_json(await get_db().roles.find_one({"_id": oid}))


@router.delete("/{rol_id}")
async def eliminar_rol(rol_id: str, _: Annotated[dict, Depends(require_permiso("roles:gestionar"))]):
    oid, rol = await _rol_editable(rol_id)
    if await get_db().usuarios.find_one({"rol": rol["clave"]}, {"_id": 1}) is not None:
        raise HTTPException(409, "No se puede eliminar un rol asignado a usuarios")
    resultado = await get_db().roles.delete_one({"_id": oid, "sistema": {"$ne": True}})
    if resultado.deleted_count == 0:
        raise HTTPException(409, "Los roles del sistema son inmutables")
    return {"ok": True}
