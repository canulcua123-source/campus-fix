import json
from types import SimpleNamespace

import pytest
from pymongo.errors import WriteError
from redis.exceptions import RedisError

import app.routers.ia as ia_router
import app.services.config_ia as config_ia_service
import app.services.ia as ia_service
from app.schemas.ia import AnalisisImagen

from .helpers import cuerpo

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
    AnalisisImagen.model_validate(r.json())
    assert ia_falsa == [(len(PNG), "image/png", "pasillo del edificio A")]


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


async def test_ia_apagada_503(api, ia_falsa):
    apagada = await api.c.patch("/config/ia", json={"habilitada": False}, headers=api.h("admin"))
    assert apagada.status_code == 200, apagada.text
    try:
        assert (await _post(api)).status_code == 503
        assert ia_falsa == []
    finally:
        restaurada = await api.c.patch("/config/ia", json={"habilitada": True}, headers=api.h("admin"))
        assert restaurada.status_code == 200, restaurada.text


async def test_ia_error_proveedor(api, monkeypatch):
    async def falla(*a, **k):
        raise RuntimeError("anthropic caído")

    monkeypatch.setattr(ia_router, "analizar_imagen", falla)
    r = await _post(api)
    assert r.status_code == 503
    assert "anthropic" not in r.text.lower()


async def test_crear_incidencia_con_ia_caida(api, monkeypatch):
    async def falla(*_a, **_k):
        raise RuntimeError("proveedor caído")

    monkeypatch.setattr(ia_router, "analizar_imagen", falla)
    assert (await _post(api)).status_code == 503
    creada = await api.c.post("/incidencias", json=cuerpo(), headers=api.h("reportante_a"))
    assert creada.status_code == 201, creada.text
    assert "ia_sugerencia" not in await api.doc(creada.json()["_id"])


async def test_payload_ia_sin_datos_personales(api, monkeypatch):
    capturado = {}

    class Mensajes:
        async def create(self, **kwargs):
            capturado.update(kwargs)
            return SimpleNamespace(
                stop_reason="end_turn",
                content=[SimpleNamespace(type="text", text=ANALISIS.model_dump_json())],
            )

    cliente = SimpleNamespace(beta=SimpleNamespace(messages=Mensajes()))
    monkeypatch.setattr(ia_service.anthropic, "AsyncAnthropic", lambda **_kwargs: cliente)
    usuario = api.u["reportante_a"]
    contexto = f"Reportó {usuario['nombre']} ({usuario['correo']}) en el pasillo"
    r = await _post(api, contexto=contexto)
    assert r.status_code == 200, r.text
    payload = json.dumps(capturado, default=str)
    assert usuario["nombre"] not in payload
    assert usuario["correo"] not in payload
    assert "[dato omitido]" in payload


# ---------- Configuración de IA ----------


async def test_config_ia_lectura_actualizacion_persistencia_y_cache(api):
    inicial = await api.c.get("/config/ia", headers=api.h("admin"))
    assert inicial.status_code == 200, inicial.text
    try:
        r = await api.c.patch(
            "/config/ia",
            json={"habilitada": False, "limite_diario_usuario": 21, "limite_diario_global": 301},
            headers=api.h("admin"),
        )
        assert r.status_code == 200, r.text
        esperado = {"habilitada": False, "limite_diario_usuario": 21, "limite_diario_global": 301}
        assert r.json() == esperado
        doc = await api.db.configuracion_ia.find_one({"_id": "ia"})
        assert {k: doc[k] for k in esperado} == esperado
        cache = await config_ia_service.get_redis().get(config_ia_service.CLAVE_CACHE)
        assert json.loads(cache) == esperado
        ttl = await config_ia_service.get_redis().ttl(config_ia_service.CLAVE_CACHE)
        assert 0 < ttl <= 60
        assert (await api.c.get("/config/ia", headers=api.h("admin"))).json() == esperado
    finally:
        restaurada = await api.c.patch("/config/ia", json=inicial.json(), headers=api.h("admin"))
        assert restaurada.status_code == 200, restaurada.text


async def test_config_ia_403_no_admin(api):
    for metodo in ("get", "patch"):
        kwargs = {"json": {"habilitada": False}} if metodo == "patch" else {}
        r = await getattr(api.c, metodo)("/config/ia", headers=api.h("directivo"), **kwargs)
        assert r.status_code == 403, r.text


async def test_config_ia_401(api):
    assert (await api.c.get("/config/ia")).status_code == 401
    assert (await api.c.patch("/config/ia", json={"habilitada": False})).status_code == 401


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"habilitada": None},
        {"limite_diario_usuario": 0},
        {"limite_diario_usuario": 1001},
        {"limite_diario_global": 0},
        {"limite_diario_global": 100001},
        {"extra": True},
    ],
)
async def test_config_ia_400_limites_invalidos(api, body):
    assert (await api.c.patch("/config/ia", json=body, headers=api.h("admin"))).status_code == 400


async def test_config_ia_sin_redis_usa_mongo(api, monkeypatch):
    class RedisCaido:
        async def get(self, *_a, **_k):
            raise RedisError("caído")

        async def set(self, *_a, **_k):
            raise RedisError("caído")

    inicial = await api.db.configuracion_ia.find_one({"_id": "ia"})
    monkeypatch.setattr(config_ia_service, "get_redis", lambda: RedisCaido())
    try:
        r = await api.c.get("/config/ia", headers=api.h("admin"))
        assert r.status_code == 200, r.text
        nuevo_limite = inicial["limite_diario_usuario"] + 1
        cambio = await api.c.patch("/config/ia", json={"limite_diario_usuario": nuevo_limite}, headers=api.h("admin"))
        assert cambio.status_code == 200, cambio.text
        doc = await api.db.configuracion_ia.find_one({"_id": "ia"})
        assert doc["limite_diario_usuario"] == nuevo_limite
    finally:
        restaurada = await api.c.patch(
            "/config/ia",
            json={k: inicial[k] for k in ("habilitada", "limite_diario_usuario", "limite_diario_global")},
            headers=api.h("admin"),
        )
        assert restaurada.status_code == 200, restaurada.text


async def test_bd_valida_configuracion_ia(api):
    with pytest.raises(WriteError) as exc:
        await api.db.configuracion_ia.update_one({"_id": "ia"}, {"$set": {"limite_diario_usuario": 0}})
    assert exc.value.code == 121
