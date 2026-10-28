"""Cableado de telemetría IA: analizar-imagen registra la oferta y crear la incidencia la cierra."""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from pymongo.errors import ServerSelectionTimeoutError

import app.routers.ia as ia_router
import app.routers.incidencias as incidencias_router
from app.core.db import get_redis
from app.schemas.ia import AnalisisImagen

from .helpers import cuerpo
from .test_analitica_ia import _imagen_png

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]

PNG = _imagen_png(300, 300)


def _analisis(**cambios) -> AnalisisImagen:
    datos = {
        "es_incidencia_valida": True,
        "categoria": "infraestructura",
        "titulo": "Luminaria fundida",
        "descripcion": "Se observa una luminaria apagada en el aula",
        "prioridad_sugerida": "baja",
        "tags": ["luminaria"],
        "campos_detectados": [],
        "confianza": 0.95,
        "advertencias": [],
        "detalle_infra": {"tipo_dano": "luminaria", "riesgo_seguridad": "bajo"},
    }
    datos.update(cambios)
    return AnalisisImagen.model_validate(datos)


@pytest_asyncio.fixture(autouse=True, loop_scope="session")
async def limpiar_estado_ia(api):
    redis = get_redis()
    claves = [clave async for clave in redis.scan_iter(match="ia:*")]
    if claves:
        await redis.delete(*claves)


@pytest.fixture
def ia_falsa(monkeypatch):
    """IA falsa y proveedor único por prueba: aísla la caché y permite filtrar las métricas."""
    estado = {"analisis": _analisis(), "proveedor": f"e2e_{uuid.uuid4().hex[:10]}"}

    async def fake(_datos, _media_type, _contexto=None):
        return estado["analisis"]

    monkeypatch.setattr(ia_router, "analizar_imagen", fake)
    monkeypatch.setattr(ia_router, "identidad_proveedor", lambda: (estado["proveedor"], "modelo-e2e"))
    return estado


async def _analizar(api, quien="reportante_a"):
    r = await api.c.post("/ia/analizar-imagen", files={"imagen": ("foto.png", PNG, "image/png")}, headers=api.h(quien))
    assert r.status_code == 200, r.text
    return r.json()


def _cuerpo_sugerido(analisis_id: str, **cambios) -> dict:
    datos = cuerpo(titulo="Luminaria fundida", prioridad="baja", analisis_id=analisis_id)
    datos.update(cambios)
    return datos


async def test_analizar_registra_una_oferta(api, ia_falsa):
    respuesta = await _analizar(api)

    documentos = await api.db.ia_eventos.find({"analisis_id": respuesta["analisis_id"]}).to_list()
    assert len(documentos) == 1
    oferta = documentos[0]
    assert oferta["evento"] == "ofrecido"
    assert oferta["editado"] is False
    assert oferta["proveedor"] == ia_falsa["proveedor"]
    assert oferta["modelo"] == "modelo-e2e"
    assert oferta["modo"] == "asistido"
    assert oferta["accion"] == respuesta["accion_asistida"]
    assert oferta["categoria"] == "infraestructura"
    assert oferta["confianza"] == respuesta["analisis"]["confianza"]
    assert oferta["resultado_ia"] == "ok"
    assert 0 <= oferta["latencia_ia_ms"] <= 300_000
    assert {"titulo", "prioridad", "detalle_especifico.categoria"} <= set(oferta["campos_autollenados"])
    assert "G5" in oferta["compuertas_fallidas"]
    assert oferta["oferta_expira_en"] - oferta["fecha"] == timedelta(minutes=30)
    assert not ({"usuario_id", "nombre", "correo", "imagen_sha256"} & set(oferta))


async def test_respuesta_desde_cache_cuenta_como_oferta_sin_latencia(api, ia_falsa):
    await _analizar(api)
    segunda = await _analizar(api)
    assert segunda["cache"] is True

    oferta = await api.db.ia_eventos.find_one({"analisis_id": segunda["analisis_id"]})
    assert oferta["evento"] == "ofrecido"
    assert "latencia_ia_ms" not in oferta
    assert "resultado_ia" not in oferta


async def test_crear_incidencia_sin_cambios_cierra_como_enviado(api, ia_falsa):
    respuesta = await _analizar(api)
    r = await api.c.post("/incidencias", json=_cuerpo_sugerido(respuesta["analisis_id"]), headers=api.h("reportante_a"))
    assert r.status_code == 201, r.text

    oferta = await api.db.ia_eventos.find_one({"analisis_id": respuesta["analisis_id"]})
    assert oferta["evento"] == oferta["resultado_final"] == "enviado"
    assert oferta["editado"] is False
    assert str(oferta["incidencia_id"]) == r.json()["_id"]
    assert "campos_editados_por_usuario" not in oferta
    incidencia = await api.db.incidencias_campus.find_one({"codigo": r.json()["codigo"]})
    assert "analisis_id" not in incidencia


async def test_crear_incidencia_con_cambios_cierra_como_editado(api, ia_falsa):
    respuesta = await _analizar(api)
    r = await api.c.post(
        "/incidencias",
        json=_cuerpo_sugerido(respuesta["analisis_id"], prioridad="alta", titulo="Otra luminaria"),
        headers=api.h("reportante_a"),
    )
    assert r.status_code == 201, r.text

    oferta = await api.db.ia_eventos.find_one({"analisis_id": respuesta["analisis_id"]})
    assert oferta["resultado_final"] == "enviado"
    assert oferta["editado"] is True
    assert oferta["motivo"] == "usuario_edito"
    assert oferta["campos_editados_por_usuario"] == ["titulo", "prioridad"]


async def test_sugerencia_rechazada_cierra_como_fallback(api, ia_falsa):
    ia_falsa["analisis"] = _analisis(es_incidencia_valida=False, confianza=0.2)
    respuesta = await _analizar(api)
    assert respuesta["accion_asistida"] in {"rechazar", "preguntar"}

    r = await api.c.post("/incidencias", json=_cuerpo_sugerido(respuesta["analisis_id"]), headers=api.h("reportante_a"))
    assert r.status_code == 201, r.text
    oferta = await api.db.ia_eventos.find_one({"analisis_id": respuesta["analisis_id"]})
    assert oferta["resultado_final"] == "fallback"
    assert oferta["motivo"] == "continuo_manual"
    assert "incidencia_id" not in oferta


async def test_oferta_deshecha_por_el_cliente_no_se_reabre(api, ia_falsa):
    respuesta = await _analizar(api)
    evento = await api.c.post(
        "/ia/eventos",
        json={"analisis_id": respuesta["analisis_id"], "evento": "deshecho"},
        headers=api.h("reportante_a"),
    )
    assert evento.status_code == 200, evento.text

    r = await api.c.post("/incidencias", json=_cuerpo_sugerido(respuesta["analisis_id"]), headers=api.h("reportante_a"))
    assert r.status_code == 201, r.text
    oferta = await api.db.ia_eventos.find_one({"analisis_id": respuesta["analisis_id"]})
    assert oferta["resultado_final"] == "deshecho"


async def test_analisis_ajeno_no_cierra_la_oferta(api, ia_falsa):
    respuesta = await _analizar(api, "reportante_a")
    r = await api.c.post("/incidencias", json=_cuerpo_sugerido(respuesta["analisis_id"]), headers=api.h("reportante_b"))
    assert r.status_code == 201, r.text
    oferta = await api.db.ia_eventos.find_one({"analisis_id": respuesta["analisis_id"]})
    assert oferta["evento"] == "ofrecido"
    assert "resultado_final" not in oferta


async def test_analisis_id_invalido_responde_400(api):
    r = await api.c.post("/incidencias", json=cuerpo(analisis_id="no-es-uuid"), headers=api.h("reportante_a"))
    assert r.status_code == 400, r.text


async def test_mongo_caido_no_rompe_el_analisis(api, ia_falsa, monkeypatch):
    async def mongo_caido(*_args, **_kwargs):
        raise ServerSelectionTimeoutError("mongo no disponible")

    monkeypatch.setattr(ia_router, "registrar_oferta", mongo_caido)
    respuesta = await _analizar(api)
    assert await api.db.ia_eventos.count_documents({"analisis_id": respuesta["analisis_id"]}) == 0

    # Sin oferta registrada la incidencia se crea igual.
    monkeypatch.setattr(incidencias_router, "registrar_resultado_confiable", mongo_caido)
    r = await api.c.post("/incidencias", json=_cuerpo_sugerido(respuesta["analisis_id"]), headers=api.h("reportante_a"))
    assert r.status_code == 201, r.text


async def test_mongo_lento_no_bloquea_el_analisis(api, ia_falsa, monkeypatch):
    async def mongo_colgado(*_args, **_kwargs):
        await asyncio.sleep(30)

    monkeypatch.setattr(ia_router, "registrar_oferta", mongo_colgado)
    monkeypatch.setattr(ia_router, "TIMEOUT_TELEMETRIA_SEGUNDOS", 0.05)
    respuesta = await asyncio.wait_for(_analizar(api), timeout=5)
    assert respuesta["analisis_id"]


async def test_metricas_ia_con_datos_tras_el_flujo(api, ia_falsa):
    ahora = datetime.now(timezone.utc)
    aceptada = await _analizar(api)
    r = await api.c.post("/incidencias", json=_cuerpo_sugerido(aceptada["analisis_id"]), headers=api.h("reportante_a"))
    assert r.status_code == 201, r.text
    await get_redis().delete(*[c async for c in get_redis().scan_iter(match="ia:cache:*")])
    editada = await _analizar(api)
    r = await api.c.post(
        "/incidencias",
        json=_cuerpo_sugerido(editada["analisis_id"], prioridad="critica"),
        headers=api.h("reportante_a"),
    )
    assert r.status_code == 201, r.text

    metricas = await api.c.get(
        "/analitica/ia",
        params={
            "desde": (ahora - timedelta(days=1)).date().isoformat(),
            "hasta": ahora.date().isoformat(),
            "proveedor": ia_falsa["proveedor"],
        },
        headers=api.h("admin"),
    )
    assert metricas.status_code == 200, metricas.text
    datos = metricas.json()
    assert datos["totales"]["ofertas"] == 2
    assert datos["totales"]["enviadas"] == 2
    assert datos["totales"]["editadas"] == 1
    assert datos["tasa_edicion"]["porcentaje"] == 50
    assert datos["latencia_ia"]["muestras"] == 2
    assert {"compuerta": "G5", "total": 2} in datos["compuertas_fallidas"]
