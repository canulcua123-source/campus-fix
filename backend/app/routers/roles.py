from typing import Annotated

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pymongo.errors import DuplicateKeyError

from app.core.auditoria import registrar_auditoria
from app.core.db import get_db
from app.core.security import puede_otorgar, require_algun_permiso, require_permiso
from app.core.serial import a_json
from app.schemas.rol import RolIn, RolPatch

router = APIRouter(prefix="/roles", tags=["roles"])


@router.get("")
async def listar_roles(
    _: Annotated[dict, Depends(require_algun_permiso("roles:gestionar", "usuarios:gestionar"))],
):
    # Lectura también para quien gestiona usuarios (el selector de rol la necesita); crear/editar/borrar
    # exige roles:gestionar, exclusivo del superadmin entre los roles de sistema.
    roles = [r async for r in get_db().roles.find({}).sort("clave", 1)]
    return a_json(roles)


@router.post("", status_code=201)
async def crear_rol(datos: RolIn, usuario: Annotated[dict, Depends(require_permiso("roles:gestionar"))]):
    # Un usuario no puede otorgar permisos ni un alcance mayores a los suyos.
    if not puede_otorgar(usuario, datos.permisos, datos.alcance):
        raise HTTPException(403, "No puedes crear un rol con permisos o alcance mayores a los tuyos")
    doc = {**datos.model_dump(), "sistema": False}
    try:
        res = await get_db().roles.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(409, "Ya existe un rol con esa clave") from None
    doc["_id"] = res.inserted_id
    await registrar_auditoria(
        actor=usuario,
        accion="crear",
        recurso="roles",
        recurso_id=datos.clave,
        despues=doc,
    )
    return a_json(doc)


def _oid(rol_id: str) -> ObjectId:
    if not ObjectId.is_valid(rol_id):
        raise HTTPException(400, "Identificador inválido")
    return ObjectId(rol_id)


async def _rol_editable(rol_id: str, usuario: dict) -> tuple[ObjectId, dict]:
    """Rol personalizado que el actor puede administrar: 404 si no existe, 409 si es del sistema,
    403 si su acceso ACTUAL supera el del actor (no se degrada ni se borra un rol más poderoso)."""
    oid = _oid(rol_id)
    rol = await get_db().roles.find_one({"_id": oid})
    if rol is None:
        raise HTTPException(404, "Rol no encontrado")
    if rol.get("sistema") is True:
        raise HTTPException(409, "Los roles del sistema son inmutables")
    if not puede_otorgar(usuario, rol.get("permisos", []), rol.get("alcance", "propio")):
        raise HTTPException(403, "No puedes administrar un rol con permisos o alcance mayores a los tuyos")
    return oid, rol


async def _fallo_sin_coincidencia(oid: ObjectId) -> HTTPException:
    """El update/delete atómico no coincidió: el rol desapareció (404) o pasó a ser del sistema (409)."""
    if await get_db().roles.find_one({"_id": oid}, {"_id": 1}) is None:
        return HTTPException(404, "Rol no encontrado")
    return HTTPException(409, "Los roles del sistema son inmutables")


@router.patch("/{rol_id}")
async def editar_rol(
    rol_id: str, datos: RolPatch, usuario: Annotated[dict, Depends(require_permiso("roles:gestionar"))]
):
    oid, actual = await _rol_editable(rol_id, usuario)
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
        raise HTTPException(409, "Ya existe un rol con esa clave") from None
    if resultado.matched_count == 0:
        raise await _fallo_sin_coincidencia(oid)
    actualizado = await get_db().roles.find_one({"_id": oid})
    await registrar_auditoria(
        actor=usuario,
        accion="editar",
        recurso="roles",
        recurso_id=actual["clave"],
        antes=actual,
        despues=actualizado,
    )
    return a_json(actualizado)


@router.delete("/{rol_id}")
async def eliminar_rol(rol_id: str, usuario: Annotated[dict, Depends(require_permiso("roles:gestionar"))]):
    oid, rol = await _rol_editable(rol_id, usuario)
    if await get_db().usuarios.find_one({"rol": rol["clave"]}, {"_id": 1}) is not None:
        raise HTTPException(409, "No se puede eliminar un rol asignado a usuarios")
    resultado = await get_db().roles.delete_one({"_id": oid, "sistema": {"$ne": True}})
    if resultado.deleted_count == 0:
        raise await _fallo_sin_coincidencia(oid)
    return {"ok": True}
