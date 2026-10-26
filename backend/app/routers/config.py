from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pymongo import ReturnDocument

from app.core.config import settings
from app.core.db import get_db
from app.core.limiter import clave_usuario, limiter
from app.core.security import require_permiso
from app.schemas.config import ConfigIA, ConfigIAPatch
from app.services.config_ia import ConfiguracionIANoDisponible, actualizar_cache_config_ia, obtener_config_ia

router = APIRouter(prefix="/config", tags=["configuracion"])


@router.get("/ia", response_model=ConfigIA)
async def consultar_config_ia(_: Annotated[dict, Depends(require_permiso("configuracion:gestionar"))]):
    try:
        return await obtener_config_ia()
    except ConfiguracionIANoDisponible as exc:
        raise HTTPException(503, "La configuración de IA no está disponible") from exc


@router.patch("/ia", response_model=ConfigIA)
@limiter.limit(lambda: settings.limite_escritura, key_func=clave_usuario)
async def modificar_config_ia(
    request: Request,
    datos: ConfigIAPatch,
    _: Annotated[dict, Depends(require_permiso("configuracion:gestionar"))],
):
    cambios = datos.model_dump(exclude_unset=True, exclude_none=True)
    doc = await get_db().configuracion_ia.find_one_and_update(
        {"_id": "ia"},
        {"$set": {**cambios, "fecha_actualizacion": datetime.now(timezone.utc)}},
        projection={"_id": 0, "schema_version": 0, "fecha_actualizacion": 0},
        return_document=ReturnDocument.AFTER,
    )
    if doc is None:
        raise HTTPException(503, "La configuración de IA no está disponible")
    config = ConfigIA.model_validate(doc)
    await actualizar_cache_config_ia(config)
    return config
