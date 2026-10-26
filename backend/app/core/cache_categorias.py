"""Cache versionada y tolerante a fallos para definiciones de categorias."""

import hashlib
import json
import logging
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from typing import Any

from pydantic import BaseModel
from redis.exceptions import RedisError

from app.core.db import get_redis
from app.dominio.categorias import normalizar_clave_categoria
from app.dominio.detalle import DefinicionDetalleError, construir_modelo_detalle

logger = logging.getLogger(__name__)

TTL_DEFINICION_SEGUNDOS = 300
MAX_MODELOS_EN_MEMORIA = 128
_modelos: OrderedDict[tuple[str, int, str], type[BaseModel]] = OrderedDict()


def _clave_redis(clave: str, version: int) -> str:
    segura = normalizar_clave_categoria(clave)
    if segura != clave or type(version) is not int or version < 1:
        raise ValueError("Clave o version de categoria invalida")
    return f"categorias:definicion:v1:{segura}:{version}"


def _huella_campos(campos: list[dict[str, Any]]) -> str:
    canonico = json.dumps(campos, ensure_ascii=True, separators=(",", ":"), sort_keys=True, allow_nan=False)
    return hashlib.sha256(canonico.encode("utf-8")).hexdigest()


def modelo_detalle_cacheado(definicion: dict[str, Any]) -> type[BaseModel]:
    """Reutiliza clases Pydantic solo para la misma clave, version y contenido."""
    clave = definicion.get("clave")
    version = definicion.get("version")
    campos = definicion.get("campos")
    if not isinstance(clave, str) or type(version) is not int or not isinstance(campos, list):
        raise DefinicionDetalleError("La definicion cacheada esta incompleta")
    try:
        huella = _huella_campos(campos)
    except (TypeError, ValueError) as exc:
        raise DefinicionDetalleError("La definicion cacheada no es serializable") from exc
    llave = (clave, version, huella)
    modelo = _modelos.get(llave)
    if modelo is not None:
        _modelos.move_to_end(llave)
        return modelo
    modelo = construir_modelo_detalle(definicion)
    _modelos[llave] = modelo
    _modelos.move_to_end(llave)
    while len(_modelos) > MAX_MODELOS_EN_MEMORIA:
        _modelos.popitem(last=False)
    return modelo


async def obtener_definicion_cacheada(
    clave: str,
    version: int,
    *,
    cargar: Callable[[], Awaitable[list[dict[str, Any]] | None]],
) -> dict[str, Any] | None:
    """Obtiene campos versionados; MongoDB sigue decidiendo vigencia y actividad."""
    llave = _clave_redis(clave, version)
    redis = None
    try:
        redis = get_redis()
        contenido = await redis.get(llave)
    except (RedisError, RuntimeError):
        logger.warning("No fue posible leer la cache de categorias; se consultara MongoDB", exc_info=True)
    else:
        if contenido is not None:
            try:
                campos = json.loads(contenido)
                definicion = {"clave": clave, "version": version, "campos": campos}
                modelo_detalle_cacheado(definicion)
            except (json.JSONDecodeError, TypeError, ValueError, DefinicionDetalleError):
                logger.warning("Se ignoro una definicion corrupta en la cache de categorias")
            else:
                return definicion

    campos = await cargar()
    if campos is None:
        return None
    definicion = {"clave": clave, "version": version, "campos": campos}
    modelo_detalle_cacheado(definicion)
    if redis is not None:
        try:
            contenido = json.dumps(campos, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
            await redis.set(llave, contenido, ex=TTL_DEFINICION_SEGUNDOS)
        except (RedisError, TypeError, ValueError):
            logger.warning("No fue posible escribir la cache de categorias", exc_info=True)
    return definicion


async def invalidar_categoria(clave: str, *versiones: int) -> None:
    """Invalida el proceso actual y las versiones Redis conocidas tras un cambio."""
    segura = normalizar_clave_categoria(clave)
    for llave in [llave for llave in _modelos if llave[0] == segura]:
        _modelos.pop(llave, None)
    claves = [_clave_redis(segura, version) for version in sorted(set(versiones))]
    if not claves:
        return
    try:
        await get_redis().delete(*claves)
    except (RedisError, RuntimeError):
        # Las lecturas verifican activa/version en MongoDB antes de usar la cache.
        logger.warning("No fue posible invalidar la cache Redis de categorias", exc_info=True)


def limpiar_cache_modelos() -> None:
    """Ayuda determinista para pruebas unitarias, sin tocar Redis."""
    _modelos.clear()
