"""T-034: require_permisos (AND), cupos agénticos y kill switch en configuracion_ia."""

from datetime import datetime, timezone
from typing import Annotated

import pytest
import pytest_asyncio
from fastapi import APIRouter, Depends

import app.routers.ia as ia_router
from app.core.db import get_redis
from app.core.security import require_permisos
from app.main import app
from app.schemas.ia import AnalisisImagen
from app.schemas.incidencia import Ubicacion
from app.services.vision.compuertas import PERMISOS_AGENTICOS, UbicacionCompuertas
from app.services.vision.cupos import CupoAgenticoAgotado, clave_cupo_aula, clave_cupo_usuario

from .test_analitica_ia import _imagen_png

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]

AHORA = datetime(2026, 10, 26, 12, tzinfo=timezone.utc)
PNG = _imagen_png(300, 300)
ANALISIS = AnalisisImagen(
    es_incidencia_valida=True,
    categoria="infraestructura",
    titulo="Luminaria fundida",
    descripcion="Se observa una luminaria apagada en el aula",
    prioridad_sugerida="baja",
    tags=["luminaria"],
    campos_detectados=[],
    confianza=0.95,
    advertencias=[],
    detalle_infra={"tipo_dano": "luminaria", "riesgo_seguridad": "bajo"},
)
UBICACION = UbicacionCompuertas(
    datos=Ubicacion(edificio="Edificio A", piso=1, aula="101"),
    fuente="qr",
    existe_en_catalogo=True,
)

# Ruta de prueba: T-036 (POST /incidencias/desde-foto) usará exactamente esta dependencia.
_ruta_prueba = APIRouter()


@_ruta_prueba.get("/__prueba__/permisos-agenticos")
async def _protegida(usuario: Annotated[dict, Depends(require_permisos(*sorted(PERMISOS_AGENTICOS)))]):
    return {"ok": True}


app.include_router(_ruta_prueba)


class FechaFija(datetime):
    @classmethod
    def now(cls, tz=None):
        return AHORA if tz is not None else AHORA.replace(tzinfo=None)


async def _post(api, quien="reportante_a"):
    return await api.c.post(
        "/ia/analizar-imagen", files={"imagen": ("foto.png", PNG, "image/png")}, headers=api.h(quien)
    )


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
        llamadas.append(media_type)
        return ANALISIS

    monkeypatch.setattr(ia_router, "analizar_imagen", fake)
    monkeypatch.setattr(ia_router, "datetime", FechaFija)
    return llamadas


@pytest_asyncio.fixture(loop_scope="session")
async def agentico_verificable(api, monkeypatch):
    """Simula lo que aportarán T17/T18/T22 (ubicación por QR y sin duplicados) y enciende el kill switch."""
    monkeypatch.setattr(ia_router, "_estado_por_verificar", lambda _usuario: (UBICACION, "no_encontrado"))
    inicial = (await api.c.get("/config/ia", headers=api.h("admin"))).json()
    r = await api.c.patch("/config/ia", json={"modo_agentico_habilitado": True}, headers=api.h("admin"))
    assert r.status_code == 200, r.text
    yield
    await api.c.patch(
        "/config/ia", json={"modo_agentico_habilitado": inicial["modo_agentico_habilitado"]}, headers=api.h("admin")
    )


def _claves(api):
    return clave_cupo_usuario(api.oid("reportante_a"), AHORA), clave_cupo_aula(UBICACION.datos, AHORA)


@pytest.mark.parametrize("permiso", sorted(PERMISOS_AGENTICOS))
async def test_falta_cualquier_permiso_responde_403(api, permiso):
    rol = await api.db.roles.find_one({"clave": "reportante"})
    try:
        assert (await api.c.get("/__prueba__/permisos-agenticos", headers=api.h("reportante_a"))).status_code == 200
        await api.db.roles.update_one({"_id": rol["_id"]}, {"$pull": {"permisos": permiso}})
        r = await api.c.get("/__prueba__/permisos-agenticos", headers=api.h("reportante_a"))
        assert r.status_code == 403, r.text
        assert permiso in r.text
    finally:
        await api.db.roles.update_one({"_id": rol["_id"]}, {"$set": {"permisos": rol["permisos"]}})


async def test_modo_asistido_solo_requiere_ia_usar(api, ia_falsa, agentico_verificable):
    rol = await api.db.roles.find_one({"clave": "reportante"})
    try:
        await api.db.roles.update_one({"_id": rol["_id"]}, {"$pull": {"permisos": "evidencias:subir"}})
        r = await _post(api)
        assert r.status_code == 200, r.text
        assert r.json()["accion"] == "formulario"
        assert r.json()["accion_asistida"] == "autollenar"
    finally:
        await api.db.roles.update_one({"_id": rol["_id"]}, {"$set": {"permisos": rol["permisos"]}})


async def test_calidad_cliente_hace_fallar_g4_y_degrada_a_formulario(api, ia_falsa, agentico_verificable):
    """T-051: la pista del control de calidad del cliente llega a las compuertas (G4) y no consume cupo agéntico."""
    clave_usuario, clave_aula = _claves(api)
    r = await api.c.post(
        "/ia/analizar-imagen",
        files={"imagen": ("foto.png", PNG, "image/png")},
        data={"calidad_cliente": "borrosa,oscura"},
        headers=api.h("reportante_a"),
    )

    assert r.status_code == 200, r.text
    assert r.json()["accion"] == "formulario"
    assert await get_redis().mget(clave_usuario, clave_aula) == [None, None]


async def test_calidad_cliente_desconocida_responde_400(api, ia_falsa):
    r = await api.c.post(
        "/ia/analizar-imagen",
        files={"imagen": ("foto.png", PNG, "image/png")},
        data={"calidad_cliente": "borrosa,inventada"},
        headers=api.h("reportante_a"),
    )

    assert r.status_code == 400, r.text
    assert ia_falsa == []


async def test_oferta_agentica_consume_ambos_cupos(api, ia_falsa, agentico_verificable):
    clave_usuario, clave_aula = _claves(api)
    r = await _post(api)

    assert r.status_code == 200, r.text
    assert r.json()["accion"] == "agentico"
    assert await get_redis().mget(clave_usuario, clave_aula) == ["1", "1"]


async def test_cupo_diario_por_usuario_agotado_degrada_a_formulario(api, ia_falsa, agentico_verificable):
    clave_usuario, clave_aula = _claves(api)
    await get_redis().set(clave_usuario, 10, ex=3600)

    r = await _post(api)

    assert r.status_code == 200, r.text
    assert r.json()["accion"] == "formulario"
    assert any("cupos" in motivo for motivo in r.json()["motivos"])
    assert await get_redis().get(clave_aula) is None


async def test_cupo_por_aula_y_hora_agotado_degrada_a_formulario(api, ia_falsa, agentico_verificable):
    clave_usuario, clave_aula = _claves(api)
    await get_redis().set(clave_aula, 3, ex=3600)

    r = await _post(api)

    assert r.status_code == 200, r.text
    assert r.json()["accion"] == "formulario"
    assert await get_redis().get(clave_usuario) is None


async def test_kill_switch_apagado_siempre_devuelve_formulario(api, ia_falsa, monkeypatch):
    monkeypatch.setattr(ia_router, "_estado_por_verificar", lambda _usuario: (UBICACION, "no_encontrado"))
    clave_usuario, clave_aula = _claves(api)
    assert (await api.c.get("/config/ia", headers=api.h("admin"))).json()["modo_agentico_habilitado"] is False

    r = await _post(api)

    assert r.status_code == 200, r.text
    assert r.json()["accion"] == "formulario"
    assert await get_redis().mget(clave_usuario, clave_aula) == [None, None]


async def test_config_agentica_por_defecto_y_validacion(api):
    config = (await api.c.get("/config/ia", headers=api.h("admin"))).json()
    assert config["modo_agentico_habilitado"] is False
    assert config["categorias_agenticas"] == ["infraestructura"]
    assert (config["cupo_agentico_usuario_diario"], config["cupo_agentico_aula_hora"]) == (10, 3)
    for cuerpo in (
        {"categorias_agenticas": ["infraestructura", "infraestructura"]},
        {"categorias_agenticas": ["no_determinada"]},
        {"cupo_agentico_aula_hora": 0},
        {"modo_agentico_habilitado": None},
    ):
        assert (await api.c.patch("/config/ia", json=cuerpo, headers=api.h("admin"))).status_code == 400


async def test_cupo_agotado_explica_que_hacer():
    assert "formulario" in str(CupoAgenticoAgotado("usuario", 10))
    assert "aula" in str(CupoAgenticoAgotado("aula", 3))


async def test_init_db_completa_campos_agenticos_en_config_existente(api):
    from scripts.init_db import sembrar_base

    original = await api.db.configuracion_ia.find_one({"_id": "ia"})
    legado = {k: original[k] for k in ("_id", "schema_version", "habilitada", "fecha_actualizacion")}
    legado.update(limite_diario_usuario=7, limite_diario_global=70)
    try:
        await api.db.configuracion_ia.replace_one({"_id": "ia"}, legado, bypass_document_validation=True)
        await sembrar_base(api.db)
        doc = await api.db.configuracion_ia.find_one({"_id": "ia"})
        assert (doc["limite_diario_usuario"], doc["limite_diario_global"]) == (7, 70)
        assert doc["modo_agentico_habilitado"] is False
        assert doc["categorias_agenticas"] == ["infraestructura"]
        assert (doc["cupo_agentico_usuario_diario"], doc["cupo_agentico_aula_hora"]) == (10, 3)
        # Ya completo, el documento vuelve a cumplir el validador estricto.
        await api.db.configuracion_ia.update_one({"_id": "ia"}, {"$set": {"limite_diario_usuario": 8}})
    finally:
        await api.db.configuracion_ia.replace_one({"_id": "ia"}, original)
        await get_redis().delete("config:ia")
