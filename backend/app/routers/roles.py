from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pymongo.errors import DuplicateKeyError

from app.core.db import get_db
from app.core.security import puede_otorgar, require_permiso
from app.schemas.rol import RolIn

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
