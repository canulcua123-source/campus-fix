"""Conexiones compartidas a MongoDB (PyMongo Async) y Redis."""
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from redis.asyncio import Redis

from app.core.config import settings

_cliente: AsyncMongoClient | None = None
_redis: Redis | None = None


def abrir() -> None:
    global _cliente, _redis
    _cliente = AsyncMongoClient(settings.mongodb_uri, tz_aware=True)
    _redis = Redis.from_url(settings.redis_url, decode_responses=True)


async def cerrar() -> None:
    global _cliente, _redis
    if _cliente is not None:
        await _cliente.close()
    if _redis is not None:
        await _redis.aclose()
    _cliente = _redis = None


def get_db() -> AsyncDatabase:
    if _cliente is None:
        raise RuntimeError("MongoDB no inicializado")
    return _cliente[settings.mongodb_db]


def get_redis() -> Redis:
    if _redis is None:
        raise RuntimeError("Redis no inicializado")
    return _redis
