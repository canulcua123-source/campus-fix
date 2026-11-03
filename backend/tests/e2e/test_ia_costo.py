"""#179: IA no configurada sin gastar cupo y candado en vuelo para peticiones idénticas."""

import asyncio
from datetime import datetime, timezone

import pytest
import pytest_asyncio

import app.routers.ia as ia_router
import app.services.vision as vision
from app.core.config import settings
from app.core.db import get_redis
from app.schemas.ia import AnalisisImagen

from .test_analitica_ia import _imagen_png

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]

PNG = _imagen_png(320, 320)
CLAVE_CACHE = "ia:cache:prueba-candado-179"
ANALISIS = AnalisisImagen(
    es_incidencia_valida=True,
    categoria="computo_redes",
    titulo="Proyector sin señal",
    descripcion="El proyector del aula no muestra imagen",
    prioridad_sugerida="media",
    tags=["proyector"],
    campos_detectados=[],
    confianza=0.9,
    advertencias=[],
)


@pytest_asyncio.fixture(autouse=True, loop_scope="session")
async def limpiar_estado_ia(api):
    redis = get_redis()
    claves = [clave async for clave in redis.scan_iter(match="ia:*")]
    if claves:
        await redis.delete(*claves)


async def _post(api, quien="reportante_a"):
    return await api.c.post(
        "/ia/analizar-imagen", files={"imagen": ("foto.png", PNG, "image/png")}, headers=api.h(quien)
    )


async def test_ia_sin_llave_responde_503_sin_consumir_cupo(api, monkeypatch, caplog):
    llamadas = []

    async def fake(*_a, **_k):
        llamadas.append(1)
        return ANALISIS

    vision.reiniciar_proveedores()
    monkeypatch.setattr(ia_router, "obtener_proveedor", vision.obtener_proveedor)
    monkeypatch.setattr(ia_router, "analizar_imagen", fake)
    monkeypatch.setattr(settings, "ia_proveedor", "claude")
    monkeypatch.setattr(settings, "anthropic_api_key", "")
    claves_cupo = ia_router._claves_cupo(api.oid("reportante_a"), datetime.now(timezone.utc))
    try:
        with caplog.at_level("WARNING", logger="app.routers.ia"):
            r = await _post(api)
    finally:
        vision.reiniciar_proveedores()

    assert r.status_code == 503, r.text
    assert r.json()["detalle"] == "El análisis con IA no está configurado en este servidor"
    assert "no está configurado" in caplog.text
    assert llamadas == []
    assert await get_redis().mget(*claves_cupo) == [None, None]


async def test_peticiones_identicas_simultaneas_pagan_una_vez(api, monkeypatch):
    llamadas = []

    async def lento(*_a, **_k):
        llamadas.append(1)
        await asyncio.sleep(0.3)
        return ANALISIS

    monkeypatch.setattr(ia_router, "analizar_imagen", lento)
    monkeypatch.setattr(ia_router, "SONDEO_CANDADO_SEGUNDOS", 0.05)
    claves_cupo = ia_router._claves_cupo(api.oid("reportante_a"), datetime.now(timezone.utc))

    primera, segunda = await asyncio.gather(_post(api), _post(api))

    assert primera.status_code == 200, primera.text
    assert segunda.status_code == 200, segunda.text
    assert len(llamadas) == 1
    assert sorted([primera.json()["cache"], segunda.json()["cache"]]) == [False, True]
    assert (await get_redis().mget(*claves_cupo))[0] == "1"
    assert [c async for c in get_redis().scan_iter(match="ia:cache:*:candado")] == []


async def test_candado_ocupado_sin_resultado_responde_503(api, monkeypatch):
    llamadas = []

    async def fake(*_a, **_k):
        llamadas.append(1)
        return ANALISIS

    monkeypatch.setattr(ia_router, "analizar_imagen", fake)
    monkeypatch.setattr(ia_router, "_clave_cache", lambda *_a, **_k: CLAVE_CACHE)
    monkeypatch.setattr(ia_router, "ESPERA_CANDADO_SEGUNDOS", 0.2)
    monkeypatch.setattr(ia_router, "SONDEO_CANDADO_SEGUNDOS", 0.05)
    redis = get_redis()
    await redis.set(f"{CLAVE_CACHE}:candado", "otra-peticion", ex=30)

    r = await _post(api)

    assert r.status_code == 503, r.text
    assert r.json()["detalle"] == "Ya se está analizando esta foto; inténtalo en unos segundos"
    assert llamadas == []
    # El candado ajeno no se libera desde esta petición.
    assert await redis.get(f"{CLAVE_CACHE}:candado") == "otra-peticion"


async def test_candado_se_libera_si_el_proveedor_falla(api, monkeypatch):
    async def falla(*_a, **_k):
        raise RuntimeError("proveedor caído")

    monkeypatch.setattr(ia_router, "analizar_imagen", falla)
    monkeypatch.setattr(ia_router, "_clave_cache", lambda *_a, **_k: CLAVE_CACHE)

    r = await _post(api)

    assert r.status_code == 503
    assert r.json()["detalle"] == "No fue posible analizar la imagen con IA"
    assert await get_redis().exists(f"{CLAVE_CACHE}:candado") == 0
