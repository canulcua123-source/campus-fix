"""Caché Redis tolerante a fallos para resultados de analítica."""

import hashlib
import json
import logging
from collections.abc import Awaitable, Callable
from datetime import date, datetime
from typing import Any

from bson import ObjectId
from redis.exceptions import RedisError

from app.core.db import get_redis

logger = logging.getLogger(__name__)


def _normalizar_clave(valor: Any) -> Any:
    if isinstance(valor, dict):
        return {str(clave): _normalizar_clave(contenido) for clave, contenido in valor.items()}
    if isinstance(valor, (list, tuple)):
        return [_normalizar_clave(elemento) for elemento in valor]
    if isinstance(valor, ObjectId):
        return str(valor)
    if isinstance(valor, (datetime, date)):
        return valor.isoformat()
    if valor is None or isinstance(valor, (str, int, float, bool)):
        return valor
    raise TypeError(f"Tipo no admitido en clave de caché: {type(valor).__name__}")


def _clave_analitica(clave: str, alcance: dict[str, Any], filtros: dict[str, Any]) -> str:
    contenido = {
        "version": 1,
        "endpoint": clave,
        "alcance": _normalizar_clave(alcance),
        "filtros": _normalizar_clave(filtros),
    }
    canonico = json.dumps(contenido, ensure_ascii=True, separators=(",", ":"), sort_keys=True)
    huella = hashlib.sha256(canonico.encode("utf-8")).hexdigest()
    return f"analitica:v1:{huella}"


async def cache_analitica[T](
    clave: str,
    alcance: dict[str, Any],
    filtros: dict[str, Any],
    ttl: int = 300,
    *,
    calcular: Callable[[], Awaitable[T]],
    validar: Callable[[Any], bool] | None = None,
) -> T:
    """Obtiene o calcula un resultado; Redis nunca sustituye la autorización ni MongoDB."""
    if ttl <= 0:
        raise ValueError("El TTL de analítica debe ser positivo")

    clave_redis = _clave_analitica(clave, alcance, filtros)
    redis = get_redis()
    try:
        contenido = await redis.get(clave_redis)
    except RedisError:
        logger.warning("No fue posible leer la caché de analítica; se consultará MongoDB", exc_info=True)
    else:
        if contenido is not None:
            try:
                resultado_cache = json.loads(contenido)
            except (json.JSONDecodeError, TypeError, UnicodeDecodeError):
                logger.warning("Se ignoró una entrada corrupta en la caché de analítica")
            else:
                if validar is None or validar(resultado_cache):
                    return resultado_cache
                logger.warning("Se ignoró una entrada incompatible en la caché de analítica")

    resultado = await calcular()
    try:
        contenido = json.dumps(resultado, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        await redis.set(clave_redis, contenido, ex=ttl)
    except (RedisError, TypeError, ValueError):
        logger.warning("No fue posible escribir la caché de analítica; se devolverá el cálculo", exc_info=True)
    return resultado
