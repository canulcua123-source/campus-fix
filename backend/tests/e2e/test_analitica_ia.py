from datetime import datetime, timedelta, timezone

import pytest
from redis.exceptions import RedisError

import app.routers.analitica as analitica_router
import app.routers.ia as ia_router
from app.core import cache as cache_core
from app.core.config import settings
from app.core.db import get_redis
from app.schemas.ia import AnalisisImagen

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]

FILTRO_RESUELTAS = {"estado": {"$in": ["resuelta", "cerrada"]}, "fecha_resolucion": {"$type": "date"}}


async def _limpiar_cache_analitica():
    redis = get_redis()
    claves = [clave async for clave in redis.scan_iter(match="analitica:v1:*")]
    if claves:
        await redis.delete(*claves)


async def _preparar(api):
    # Garantiza datos resueltos en ambas categorías y edificios distintos
    await api.crear_en("resuelta", "reportante_a", "infraestructura", edificio="Edificio A", tags=["analitica_tag", "luz"])
    await api.crear_en("cerrada", "reportante_a", "infraestructura", edificio="Edificio B", tags=["analitica_tag"])
    await api.crear_en("resuelta", "reportante_a", "computo_redes", edificio="Edificio C", tags=["analitica_tag", "red"])


async def test_analitica_edificios(api):
    await _preparar(api)
    await _limpiar_cache_analitica()
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
    await _limpiar_cache_analitica()
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


@pytest.mark.parametrize("quien,esperado", [
    ("reportante_a", 403), ("tecnico_infra", 403), ("jefe_a", 403),
    ("coordinador_infra", 200), ("directivo", 200), ("admin", 200),
])
async def test_analitica_permisos(api, quien, esperado):
    for ruta in ("/analitica/edificios", "/analitica/tags", "/analitica/resumen"):
        assert (await api.c.get(ruta, headers=api.h(quien))).status_code == esperado, ruta
    assert (await api.c.get("/analitica/resumen")).status_code == 401


async def test_resumen_cuenta_por_estado(api):
    await _limpiar_cache_analitica()
    antes = (await api.c.get("/analitica/resumen", headers=api.h("directivo"))).json()

    await api.crear(prioridad="critica")
    en_proceso = await api.crear()
    await api.a_estado(en_proceso["_id"], "en_proceso")
    await api.crear_en("resuelta", prioridad="critica")
    await _limpiar_cache_analitica()

    r = await api.c.get("/analitica/resumen", headers=api.h("directivo"))
    assert r.status_code == 200, r.text
    despues = r.json()
    assert despues["abiertas"] == antes["abiertas"] + 1
    assert despues["en_proceso"] == antes["en_proceso"] + 1
    assert despues["criticas"] == antes["criticas"] + 2
    assert despues["resueltas_periodo"] == antes["resueltas_periodo"] + 1
    assert all(isinstance(valor, int) and valor >= 0 for valor in despues.values())


async def test_resumen_filtra_periodo(api):
    hoy = datetime.now(timezone.utc).date()
    manana = hoy + timedelta(days=1)
    parametros_hoy = {"desde": hoy.isoformat(), "hasta": hoy.isoformat(), "categoria": "infraestructura"}
    parametros_manana = {
        "desde": manana.isoformat(),
        "hasta": manana.isoformat(),
        "categoria": "infraestructura",
    }
    await _limpiar_cache_analitica()
    antes_hoy = (
        await api.c.get("/analitica/resumen", params=parametros_hoy, headers=api.h("directivo"))
    ).json()
    antes_manana = (
        await api.c.get("/analitica/resumen", params=parametros_manana, headers=api.h("directivo"))
    ).json()

    await api.crear_en("resuelta")
    await _limpiar_cache_analitica()

    despues_hoy = (
        await api.c.get("/analitica/resumen", params=parametros_hoy, headers=api.h("directivo"))
    ).json()
    despues_manana = (
        await api.c.get("/analitica/resumen", params=parametros_manana, headers=api.h("directivo"))
    ).json()
    assert despues_hoy["resueltas_periodo"] == antes_hoy["resueltas_periodo"] + 1
    assert despues_manana["resueltas_periodo"] == antes_manana["resueltas_periodo"]


async def test_resumen_alcance_coordinador(api):
    await api.crear(categoria="computo_redes", prioridad="critica")
    await _limpiar_cache_analitica()
    parametros = {"categoria": "computo_redes"}

    global_ = await api.c.get("/analitica/resumen", params=parametros, headers=api.h("directivo"))
    coordinador = await api.c.get(
        "/analitica/resumen",
        params=parametros,
        headers=api.h("coordinador_infra"),
    )

    assert global_.status_code == coordinador.status_code == 200
    assert global_.json()["abiertas"] > 0
    assert global_.json()["criticas"] > 0
    assert coordinador.json() == {
        "abiertas": 0,
        "en_proceso": 0,
        "criticas": 0,
        "resueltas_periodo": 0,
    }


async def test_cache_separada_por_alcance(api):
    await _limpiar_cache_analitica()

    assert (await api.c.get("/analitica/resumen", headers=api.h("directivo"))).status_code == 200
    assert (await api.c.get("/analitica/resumen", headers=api.h("coordinador_infra"))).status_code == 200

    claves = [clave async for clave in get_redis().scan_iter(match="analitica:v1:*")]
    assert len(claves) == 2
    assert claves[0] != claves[1]


@pytest.mark.parametrize(
    "parametros",
    [
        {"desde": "2026-02-30"},
        {"desde": "22-10-2026"},
        {"desde": "2026-10-22T00:00:00Z"},
        {"desde": "2026-10-23", "hasta": "2026-10-22"},
        {"categoria": "otra"},
        [("categoria", "academico"), ("categoria", "infraestructura")],
        {"otro": "valor"},
    ],
    ids=["inexistente", "formato", "instante", "invertido", "categoria", "duplicado", "inesperado"],
)
async def test_filtro_fecha_invalida_400(api, parametros):
    r = await api.c.get("/analitica/resumen", params=parametros, headers=api.h("directivo"))
    assert r.status_code == 400, r.text
    assert r.json()["error"] == "validacion"
    assert isinstance(r.json()["detalle"], str | list)


async def test_analitica_cache_hit(api, monkeypatch):
    await _limpiar_cache_analitica()
    llamadas = 0

    async def agregar_falso(_pipeline):
        nonlocal llamadas
        llamadas += 1
        return [{"abiertas": 7, "en_proceso": 2, "criticas": 1, "resueltas_periodo": 4}]

    monkeypatch.setattr(analitica_router, "_agregar", agregar_falso)
    primera = await api.c.get("/analitica/resumen", headers=api.h("directivo"))
    segunda = await api.c.get("/analitica/resumen", headers=api.h("directivo"))

    assert primera.status_code == segunda.status_code == 200
    assert primera.json() == segunda.json()
    assert llamadas == 1
    claves = [clave async for clave in get_redis().scan_iter(match="analitica:v1:*")]
    assert len(claves) == 1
    clave = claves[0]
    ttl = await get_redis().ttl(clave)
    assert 0 < ttl <= 300


async def test_analitica_sin_redis_responde(api, monkeypatch):
    await _limpiar_cache_analitica()

    class RedisCaido:
        async def get(self, _clave):
            raise RedisError("fallo simulado")

        async def set(self, _clave, _contenido, *, ex):
            raise RedisError("fallo simulado")

    monkeypatch.setattr(cache_core, "get_redis", lambda: RedisCaido())
    r = await api.c.get("/analitica/resumen", headers=api.h("directivo"))
    assert r.status_code == 200, r.text
    assert set(r.json()) == {"abiertas", "en_proceso", "criticas", "resueltas_periodo"}


# ---------- IA ----------

ANALISIS = AnalisisImagen(
    es_incidencia_valida=True, categoria="infraestructura", titulo="Luminaria fundida",
    descripcion="Se observa una luminaria apagada", prioridad_sugerida="baja", tags=["luminaria"],
    campos_detectados=[{"nombre": "tipo", "valor": "luminaria"}], confianza=0.9, advertencias=[],
)
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 100


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
    return await api.c.post("/ia/analizar-imagen", files={"imagen": (nombre, datos, mime)}, data=data,
                            headers=api.h(quien))


async def test_ia_ok(api, ia_falsa):
    r = await _post(api, contexto="pasillo del edificio A")
    assert r.status_code == 200, r.text
    assert r.json()["categoria"] == "infraestructura"
    AnalisisImagen.model_validate(r.json())
    assert ia_falsa == [(len(PNG), "image/png", "pasillo del edificio A")]


@pytest.mark.parametrize("quien,esperado", [("directivo", 403), ("jefe_a", 403), ("tecnico_infra", 200)])
async def test_ia_permisos(api, ia_falsa, quien, esperado):
    assert (await _post(api, quien=quien)).status_code == esperado


@pytest.mark.parametrize("nombre,mime,datos", [
    ("a.txt", "text/plain", b"hola"),
    ("a.gif", "image/gif", b"GIF89a"),
    ("grande.png", "image/png", b"0" * (5 * 1024 * 1024 + 1)),
], ids=["texto", "gif", "mayor_5mb"])
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


async def test_ia_error_proveedor(api, monkeypatch):
    async def falla(*a, **k):
        raise RuntimeError("anthropic caído")

    monkeypatch.setattr(ia_router, "analizar_imagen", falla)
    r = await _post(api)
    assert r.status_code == 503
    assert "anthropic" not in r.text.lower()
