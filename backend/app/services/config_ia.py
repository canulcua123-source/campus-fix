import logging

from pydantic import ValidationError
from redis.exceptions import RedisError

from app.core.db import get_db, get_redis
from app.schemas.config import ConfigIA

CLAVE_CACHE = "config:ia"
TTL_CACHE_SEGUNDOS = 60
logger = logging.getLogger(__name__)


class ConfiguracionIANoDisponible(Exception):
    pass


async def obtener_config_ia() -> ConfigIA:
    try:
        cache = await get_redis().get(CLAVE_CACHE)
        if cache:
            return ConfigIA.model_validate_json(cache)
    except (RedisError, ValidationError) as exc:
        logger.warning("No se pudo leer la caché de configuración de IA: %s", type(exc).__name__)

    doc = await get_db().configuracion_ia.find_one(
        {"_id": "ia"}, {"_id": 0, "schema_version": 0, "fecha_actualizacion": 0}
    )
    if doc is None:
        raise ConfiguracionIANoDisponible("Falta inicializar la configuración de IA")
    config = ConfigIA.model_validate(doc)
    await actualizar_cache_config_ia(config)
    return config


async def actualizar_cache_config_ia(config: ConfigIA) -> None:
    try:
        await get_redis().set(CLAVE_CACHE, config.model_dump_json(), ex=TTL_CACHE_SEGUNDOS)
    except RedisError as exc:
        logger.warning("No se pudo actualizar la caché de configuración de IA: %s", type(exc).__name__)
