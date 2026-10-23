from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.db import get_db
from app.core.security import get_usuario_actual
from app.core.serial import a_json

router = APIRouter(prefix="/categorias", tags=["categorias"])


@router.get("")
async def listar_categorias(_: Annotated[dict, Depends(get_usuario_actual)]):
    docs = [c async for c in get_db().categorias.find({"activa": True}).sort("clave", 1)]
    return a_json(docs)
