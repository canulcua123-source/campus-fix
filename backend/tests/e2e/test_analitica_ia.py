from datetime import datetime, timezone

import pytest
import pytest_asyncio

import app.routers.ia as ia_router
from app.core.config import settings
from app.core.db import get_redis
from app.schemas.ia import AnalisisImagen, RespuestaAnalisisImagen

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]

FILTRO_RESUELTAS = {"estado": {"$in": ["resuelta", "cerrada"]}, "fecha_resolucion": {"$type": "date"}}


async def _preparar(api):
    # Garantiza datos resueltos en ambas categorías y edificios distintos
    await api.crear_en(
        "resuelta", "reportante_a", "infraestructura", edificio="Edificio A", tags=["analitica_tag", "luz"]
    )
    await api.crear_en("cerrada", "reportante_a", "infraestructura", edificio="Edificio B", tags=["analitica_tag"])
    await api.crear_en(
        "resuelta", "reportante_a", "computo_redes", edificio="Edificio C", tags=["analitica_tag", "red"]
    )


async def test_analitica_edificios(api):
    await _preparar(api)
    r = await api.c.get("/analitica/edificios", headers=api.h("directivo"))
    assert r.status_code == 200, r.text
    filas = r.json()
    assert len(filas) <= 10
    for f in filas:
        assert set(f) == {"edificio", "total", "horas_invertidas", "horas_resolucion_prom"}
        if f["horas_resolucion_prom"] is not None:
            assert round(f["horas_resolucion_prom"], 1) == f["horas_resolucion_prom"]
    proms = [f["horas_resolucion_prom"] or 0 for f in filas]
    assert proms == sorted(proms, reverse=True)
    total_bd = await api.db.incidencias_campus.count_documents(FILTRO_RESUELTAS)
    assert sum(f["total"] for f in filas) == total_bd

    r = await api.c.get("/analitica/edificios", headers=api.h("coordinador_infra"))
    assert r.status_code == 200
    filas_c = r.json()
    total_infra = await api.db.incidencias_campus.count_documents({**FILTRO_RESUELTAS, "categoria": "infraestructura"})
    assert sum(f["total"] for f in filas_c) == total_infra < total_bd
    assert "Edificio C" not in {f["edificio"] for f in filas_c}  # sólo hay redes resueltas en C


async def test_analitica_tags(api):
    await _preparar(api)
    r = await api.c.get("/analitica/tags", headers=api.h("admin"))
    assert r.status_code == 200, r.text
    filas = r.json()
    assert 0 < len(filas) <= 10
    assert all(set(f) == {"tag", "total"} for f in filas)
    totales = [f["total"] for f in filas]
    assert totales == sorted(totales, reverse=True)

    r = await api.c.get("/analitica/tags", headers=api.h("coordinador_infra"))
    tags_c = {f["tag"]: f["total"] for f in r.json()}
    assert "red" not in tags_c
    n = await api.db.incidencias_campus.count_documents({"categoria": "infraestructura", "tags": "analitica_tag"})
    if "analitica_tag" in tags_c:
        assert tags_c["analitica_tag"] == n


@pytest.mark.parametrize(
    "quien,esperado",
    [
        ("reportante_a", 403),
        ("tecnico_infra", 403),
        ("jefe_a", 403),
        ("coordinador_infra", 200),
        ("directivo", 200),
        ("admin", 200),
    ],
)
async def test_analitica_permisos(api, quien, esperado):
    for ruta in ("/analitica/edificios", "/analitica/tags"):
        assert (await api.c.get(ruta, headers=api.h(quien))).status_code == esperado, ruta
    assert (await api.c.get("/analitica/tags")).status_code == 401


# ---------- IA ----------

ANALISIS = AnalisisImagen(
    es_incidencia_valida=True,
    categoria="infraestructura",
    titulo="Luminaria fundida",
    descripcion="Se observa una luminaria apagada",
    prioridad_sugerida="baja",
    tags=["luminaria"],
    campos_detectados=[{"nombre": "tipo", "valor": "luminaria"}],
    confianza=0.9,
    advertencias=[],
)
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 100


@pytest_asyncio.fixture(autouse=True, loop_scope="session")
async def limpiar_estado_ia(api):
    redis = get_redis()
    claves = [clave async for clave in redis.scan_iter(match="ia:*")]
    if claves:
        await redis.delete(*claves)


@pytest.fixture
def ia_falsa(monkeypatch):
    llamadas = []

    async def fake(datos, media_type, contexto=None):
        llamadas.append((len(datos), media_type, contexto))
        return ANALISIS

    monkeypatch.setattr(ia_router, "analizar_imagen", fake)
    return llamadas


async def _post(api, quien="reportante_a", nombre="foto.png", datos=PNG, mime="image/png", contexto=None):
    data = {"contexto": contexto} if contexto else None
    return await api.c.post(
        "/ia/analizar-imagen", files={"imagen": (nombre, datos, mime)}, data=data, headers=api.h(quien)
    )


async def test_ia_ok(api, ia_falsa):
    r = await _post(api, contexto="pasillo del edificio A")
    assert r.status_code == 200, r.text
    assert r.json()["categoria"] == "infraestructura"
    assert r.json()["cache"] is False
    RespuestaAnalisisImagen.model_validate(r.json())
    assert ia_falsa == [(len(PNG), "image/png", "pasillo del edificio A")]


async def test_ia_cache_hit_no_consume_cupo(api, ia_falsa):
    redis = get_redis()
    claves_cupo = ia_router._claves_cupo(api.oid("reportante_a"), datetime.now(timezone.utc))

    primera = await _post(api, contexto="  pasillo   del edificio A ")
    cupos_tras_miss = await redis.mget(*claves_cupo)
    segunda = await _post(api, contexto="pasillo del edificio A")

    assert primera.status_code == segunda.status_code == 200
    assert primera.json()["cache"] is False
    assert segunda.json()["cache"] is True
    assert ia_falsa == [(len(PNG), "image/png", "pasillo del edificio A")]
    assert cupos_tras_miss == await redis.mget(*claves_cupo) == ["1", "1"]
    claves_cache = [clave async for clave in redis.scan_iter(match="ia:cache:*")]
    assert len(claves_cache) == 1
    assert 0 < await redis.ttl(claves_cache[0]) <= ia_router.CACHE_TTL


async def test_ia_cache_distinta_por_pistas(api, ia_falsa):
    primera = await _post(api, contexto="pasillo norte")
    segunda = await _post(api, contexto="laboratorio de redes")

    assert primera.status_code == segunda.status_code == 200
    assert primera.json()["cache"] is segunda.json()["cache"] is False
    assert len(ia_falsa) == 2


async def test_ia_clave_cache_varia_con_prompt_y_proveedor():
    base = ia_router._clave_cache(PNG, "pasillo", prompt_version="v1", proveedor="anthropic", modelo="modelo")
    otro_prompt = ia_router._clave_cache(PNG, "pasillo", prompt_version="v2", proveedor="anthropic", modelo="modelo")
    otro_proveedor = ia_router._clave_cache(PNG, "pasillo", prompt_version="v1", proveedor="otro", modelo="modelo")

    assert len({base, otro_prompt, otro_proveedor}) == 3


@pytest.mark.parametrize("quien,esperado", [("directivo", 403), ("jefe_a", 403), ("tecnico_infra", 200)])
async def test_ia_permisos(api, ia_falsa, quien, esperado):
    assert (await _post(api, quien=quien)).status_code == esperado


@pytest.mark.parametrize(
    "nombre,mime,datos",
    [
        ("a.txt", "text/plain", b"hola"),
        ("a.gif", "image/gif", b"GIF89a"),
        ("grande.png", "image/png", b"0" * (5 * 1024 * 1024 + 1)),
    ],
    ids=["texto", "gif", "mayor_5mb"],
)
async def test_ia_archivo_invalido(api, ia_falsa, nombre, mime, datos):
    r = await _post(api, nombre=nombre, datos=datos, mime=mime)
    assert r.status_code == 400, r.text
    assert ia_falsa == []


async def test_ia_sin_imagen(api, ia_falsa):
    r = await api.c.post("/ia/analizar-imagen", headers=api.h("reportante_a"))
    assert r.status_code == 400


async def test_ia_deshabilitada(api, ia_falsa, monkeypatch):
    monkeypatch.setattr(settings, "ia_habilitada", False)
    assert (await _post(api)).status_code == 503
    assert ia_falsa == []


async def test_ia_fallo_devuelve_cupo(api, monkeypatch):
    async def falla(*a, **k):
        raise RuntimeError("anthropic caído")

    redis = get_redis()
    claves_cupo = ia_router._claves_cupo(api.oid("reportante_a"), datetime.now(timezone.utc))
    await redis.mset({claves_cupo[0]: 4, claves_cupo[1]: 7})
    monkeypatch.setattr(ia_router, "analizar_imagen", falla)
    r = await _post(api)

    assert r.status_code == 503
    assert "anthropic" not in r.text.lower()
    assert await redis.mget(*claves_cupo) == ["4", "7"]


async def test_ia_sin_redis_funciona(api, ia_falsa, monkeypatch):
    def redis_caido():
        raise RuntimeError("redis caído")

    monkeypatch.setattr(ia_router, "get_redis", redis_caido)
    r = await _post(api, contexto="pasillo")

    assert r.status_code == 200, r.text
    assert r.json()["cache"] is False
    assert ia_falsa == [(len(PNG), "image/png", "pasillo")]
