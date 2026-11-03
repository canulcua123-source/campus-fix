"""#181: G5 con el aula del QR, G8 con el aula del selector y búsqueda sin la categoría de la IA."""

import os
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from bson import ObjectId

os.environ["JWT_SECRET"] = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0"

import app.routers.ia as ia_router
from app.schemas.config import ConfigIA
from app.schemas.ia import AnalisisImagen
from app.services.duplicados import HuellasImagen

AULA_ID = "A" * 22
AHORA = datetime(2026, 11, 3, 12, tzinfo=timezone.utc)
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
HUELLAS = HuellasImagen(sha256="a" * 64, dhash="0" * 16)


def _db_aulas(documento):
    aulas = SimpleNamespace(find_one=AsyncMock(return_value=documento))
    return SimpleNamespace(aulas=aulas)


@pytest.mark.asyncio
async def test_g5_ubicacion_qr_de_aula_activa(monkeypatch):
    db = _db_aulas({"edificio": "Edificio A", "piso": 1, "aula": "101"})
    monkeypatch.setattr(ia_router, "get_db", lambda: db)

    ubicacion = await ia_router._ubicacion_verificada(AULA_ID)

    assert ubicacion is not None
    assert ubicacion.fuente == "qr"
    assert ubicacion.existe_en_catalogo is True
    assert ubicacion.datos.model_dump() == {"edificio": "Edificio A", "piso": 1, "aula": "101"}
    filtro = db.aulas.find_one.await_args.args[0]
    assert filtro == {"id_publico": AULA_ID, "activa": True}


@pytest.mark.asyncio
async def test_g5_sin_ubicacion_con_aula_desconocida_inactiva_o_sin_qr(monkeypatch):
    db = _db_aulas(None)  # inexistente o inactiva: el filtro exige activa=True
    monkeypatch.setattr(ia_router, "get_db", lambda: db)

    assert await ia_router._ubicacion_verificada(AULA_ID) is None
    assert await ia_router._ubicacion_verificada(None) is None
    assert db.aulas.find_one.await_count == 1


@pytest.mark.asyncio
async def test_g5_falla_cerrado_si_el_catalogo_no_responde(monkeypatch):
    db = SimpleNamespace(aulas=SimpleNamespace(find_one=AsyncMock(side_effect=RuntimeError("caido"))))
    monkeypatch.setattr(ia_router, "get_db", lambda: db)

    assert await ia_router._ubicacion_verificada(AULA_ID) is None


def _entrada(ubicacion, duplicado):
    config = ConfigIA(habilitada=True, limite_diario_usuario=10, limite_diario_global=100)
    return ia_router._entrada_compuertas(
        ANALISIS,
        {"_id": ObjectId(), "_permisos": ["ia:usar", "incidencias:crear", "evidencias:subir"]},
        AHORA,
        config,
        cupo_agentico_disponible=True,
        estado_duplicado=duplicado,
        ubicacion=ubicacion,
    )


@pytest.mark.asyncio
async def test_entrada_compuertas_g5_pasa_con_qr_y_kill_switch_sigue_mandando(monkeypatch):
    from app.services.vision.compuertas import evaluar_compuertas

    db = _db_aulas({"edificio": "Edificio A", "piso": 1, "aula": "101"})
    monkeypatch.setattr(ia_router, "get_db", lambda: db)
    ubicacion = await ia_router._ubicacion_verificada(AULA_ID)

    decision = evaluar_compuertas(_entrada(ubicacion, "no_encontrado"))
    estado = {c.id: c.paso for c in decision.compuertas}

    assert estado["G5"] is True
    assert estado["G7"] is True
    assert estado["G8"] is True
    assert estado["G9"] is False  # kill switch apagado
    assert decision.accion == "formulario"


def test_entrada_compuertas_sin_ubicacion_ni_g8_falla_cerrado():
    entrada = _entrada(None, None)
    assert entrada.ubicacion is None
    assert entrada.duplicado == "no_verificable"


@pytest.mark.asyncio
async def test_aula_del_selector_se_resuelve_con_el_catalogo(monkeypatch):
    db = _db_aulas({"id_publico": AULA_ID})
    monkeypatch.setattr(ia_router, "get_db", lambda: db)

    assert await ia_router._aula_por_ubicacion("Edificio A", 1, "101") == AULA_ID
    filtro = db.aulas.find_one.await_args.args[0]
    assert filtro == {"edificio": "Edificio A", "piso": 1, "aula": "101", "activa": True}


@pytest.mark.asyncio
async def test_aula_del_selector_incompleta_o_fuera_del_catalogo(monkeypatch):
    db = _db_aulas(None)
    monkeypatch.setattr(ia_router, "get_db", lambda: db)

    assert await ia_router._aula_por_ubicacion("Edificio A", None, "101") is None
    assert await ia_router._aula_por_ubicacion(None, 1, "101") is None
    assert db.aulas.find_one.await_count == 0
    assert await ia_router._aula_por_ubicacion("Otro", 1, "101") is None


@pytest.mark.asyncio
@pytest.mark.parametrize("categoria", ["academico", "no_determinada"])
async def test_g8_no_envia_la_categoria_de_la_ia(monkeypatch, categoria):
    detectar = AsyncMock(return_value=None)
    monkeypatch.setattr(ia_router, "detectar_duplicado_por_huellas", detectar)
    monkeypatch.setattr(ia_router, "get_db", lambda: SimpleNamespace())
    analisis = ANALISIS.model_copy(update={"categoria": categoria, "detalle_infra": None})

    estado, posible = await ia_router._evaluar_duplicado({"_id": ObjectId()}, analisis, HUELLAS, AULA_ID, AHORA)

    assert (estado, posible) == ("no_encontrado", None)
    assert "categoria" not in detectar.await_args.kwargs
    assert detectar.await_args.kwargs["aula_id"] == AULA_ID
