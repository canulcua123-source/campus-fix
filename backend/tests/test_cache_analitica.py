import json

import pytest
from redis.exceptions import RedisError

from app.core import cache


class RedisFalso:
    def __init__(self, contenido=None, *, falla_lectura=False, falla_escritura=False):
        self.contenido = contenido
        self.falla_lectura = falla_lectura
        self.falla_escritura = falla_escritura
        self.lecturas = []
        self.escrituras = []

    async def get(self, clave):
        self.lecturas.append(clave)
        if self.falla_lectura:
            raise RedisError("redis de prueba no disponible")
        return self.contenido

    async def set(self, clave, contenido, *, ex):
        if self.falla_escritura:
            raise RedisError("redis de prueba no disponible")
        self.escrituras.append((clave, contenido, ex))


@pytest.mark.asyncio
async def test_cache_hit_evita_calculo(monkeypatch):
    redis = RedisFalso(json.dumps({"abiertas": 2}))
    monkeypatch.setattr(cache, "get_redis", lambda: redis)
    llamadas = 0

    async def calcular():
        nonlocal llamadas
        llamadas += 1
        return {"abiertas": 99}

    resultado = await cache.cache_analitica(
        "resumen",
        {},
        {"categoria": None},
        calcular=calcular,
        validar=lambda valor: isinstance(valor, dict) and isinstance(valor.get("abiertas"), int),
    )

    assert resultado == {"abiertas": 2}
    assert llamadas == 0
    assert redis.escrituras == []


@pytest.mark.asyncio
async def test_cache_miss_guarda_json_con_ttl_300(monkeypatch):
    redis = RedisFalso()
    monkeypatch.setattr(cache, "get_redis", lambda: redis)

    async def calcular():
        return [{"tag": "luz", "total": 3}]

    resultado = await cache.cache_analitica("tags", {}, {}, calcular=calcular)

    assert resultado == [{"tag": "luz", "total": 3}]
    assert len(redis.escrituras) == 1
    _, contenido, ttl = redis.escrituras[0]
    assert json.loads(contenido) == resultado
    assert ttl == 300


def test_clave_separa_endpoint_alcance_categoria_y_periodo():
    base = cache._clave_analitica(
        "resumen",
        {"categoria": {"$in": ["infraestructura"]}},
        {"desde": "2026-01-01", "hasta": "2026-01-31", "categoria": "infraestructura"},
    )
    variantes = {
        cache._clave_analitica(
            "tags",
            {"categoria": {"$in": ["infraestructura"]}},
            {"desde": "2026-01-01", "hasta": "2026-01-31", "categoria": "infraestructura"},
        ),
        cache._clave_analitica(
            "resumen",
            {"categoria": {"$in": ["computo_redes"]}},
            {"desde": "2026-01-01", "hasta": "2026-01-31", "categoria": "infraestructura"},
        ),
        cache._clave_analitica(
            "resumen",
            {"categoria": {"$in": ["infraestructura"]}},
            {"desde": "2026-02-01", "hasta": "2026-02-28", "categoria": "infraestructura"},
        ),
        cache._clave_analitica(
            "resumen",
            {"categoria": {"$in": ["infraestructura"]}},
            {"desde": "2026-01-01", "hasta": "2026-01-31", "categoria": "academico"},
        ),
    }
    assert base not in variantes
    assert len(variantes) == 4
    assert base == cache._clave_analitica(
        "resumen",
        {"categoria": {"$in": ["infraestructura"]}},
        {"categoria": "infraestructura", "hasta": "2026-01-31", "desde": "2026-01-01"},
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("contenido", ["{roto", json.dumps(["forma", "incorrecta"])])
async def test_cache_corrupta_o_incompatible_recalcula(monkeypatch, contenido):
    redis = RedisFalso(contenido)
    monkeypatch.setattr(cache, "get_redis", lambda: redis)
    llamadas = 0

    async def calcular():
        nonlocal llamadas
        llamadas += 1
        return {"abiertas": 1}

    resultado = await cache.cache_analitica(
        "resumen",
        {},
        {},
        calcular=calcular,
        validar=lambda valor: isinstance(valor, dict),
    )

    assert resultado == {"abiertas": 1}
    assert llamadas == 1
    assert redis.escrituras


@pytest.mark.asyncio
@pytest.mark.parametrize("falla", ["lectura", "escritura"])
async def test_cache_fallo_redis_devuelve_calculo(monkeypatch, falla):
    redis = RedisFalso(falla_lectura=falla == "lectura", falla_escritura=falla == "escritura")
    monkeypatch.setattr(cache, "get_redis", lambda: redis)

    async def calcular():
        return {"abiertas": 4}

    assert await cache.cache_analitica("resumen", {}, {}, calcular=calcular) == {"abiertas": 4}


@pytest.mark.asyncio
async def test_cache_rechaza_ttl_no_positivo(monkeypatch):
    monkeypatch.setattr(cache, "get_redis", lambda: RedisFalso())

    async def calcular():
        return {}

    with pytest.raises(ValueError, match="TTL"):
        await cache.cache_analitica("resumen", {}, {}, ttl=0, calcular=calcular)
