from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

import app.core.security as security
import app.routers.analitica as analitica_router
from app.core.limiter import limiter, limite_general
from app.core.security import get_usuario_actual
from app.main import app
from app.routers.analitica import (
    _ESTADOS_ACTIVOS,
    _pipeline_aulas_cronicas,
    _pipeline_carga_tecnicos,
    _pipeline_tendencia,
)
from app.schemas.analitica import AulaCronica, CargaTecnico, FiltrosAnalitica, TendenciaMensual


def test_pipeline_aulas_cronicas_inicia_con_alcance_y_limita_30_dias():
    ahora = datetime(2026, 10, 24, 18, 30, tzinfo=timezone.utc)
    alcance = {"categoria": {"$in": ["infraestructura"]}}
    filtros = FiltrosAnalitica(desde="2026-01-01", hasta="2026-12-31")

    pipeline = _pipeline_aulas_cronicas(alcance, filtros, ahora)

    assert list(pipeline[0]) == ["$match"]
    partes = pipeline[0]["$match"]["$and"]
    assert partes[0] == alcance
    assert {"fecha_creacion": {"$gte": ahora - timedelta(days=30), "$lte": ahora}} in partes
    assert {"fecha_creacion": {"$type": "date"}} in partes
    assert pipeline[1] == {"$project": {
        "_id": 0,
        "edificio": "$ubicacion.edificio",
        "piso": "$ubicacion.piso",
        "aula": "$ubicacion.aula",
    }}
    assert pipeline[2]["$group"]["_id"] == {
        "edificio": "$edificio",
        "piso": "$piso",
        "aula": "$aula",
    }
    assert pipeline[3] == {"$match": {"total": {"$gte": 3}}}
    assert pipeline[4]["$sort"] == {
        "total": -1,
        "_id.edificio": 1,
        "_id.piso": 1,
        "_id.aula": 1,
    }


def test_pipeline_carga_tecnicos_usa_activos_horas_persistidas_y_excluye_sin_asignar():
    alcance = {"categoria": {"$in": ["infraestructura"]}}
    pipeline = _pipeline_carga_tecnicos(alcance, FiltrosAnalitica(categoria="infraestructura"))

    assert list(pipeline[0]) == ["$match"]
    partes = pipeline[0]["$match"]["$and"]
    assert partes[0] == alcance
    assert {"estado": {"$in": _ESTADOS_ACTIVOS}} in partes
    assert {"tecnico_asignado.usuario_id": {"$type": "objectId"}} in partes
    assert {"categoria": "infraestructura"} in partes
    assert pipeline[1]["$group"] == {
        "_id": "$tecnico_asignado.usuario_id",
        "incidencias_activas": {"$sum": 1},
        "horas_acumuladas": {"$sum": "$horas_invertidas"},
    }
    assert not any("$unwind" in etapa for etapa in pipeline)


def test_pipeline_tendencia_agrupa_mes_categoria_en_utc_y_ordena():
    filtros = FiltrosAnalitica(desde="2025-01-01", hasta="2026-12-31", categoria="academico")
    pipeline = _pipeline_tendencia({}, filtros)

    assert list(pipeline[0]) == ["$match"]
    partes = pipeline[0]["$match"]["$and"]
    assert partes[0] == {}
    assert {"categoria": "academico"} in partes
    agrupacion = pipeline[1]["$group"]["_id"]
    assert agrupacion["anio"] == {
        "$year": {"date": "$fecha_creacion", "timezone": "UTC"},
    }
    assert agrupacion["mes"] == {
        "$month": {"date": "$fecha_creacion", "timezone": "UTC"},
    }
    assert agrupacion["categoria"] == "$categoria"
    assert pipeline[2] == {"$sort": {"_id.anio": 1, "_id.mes": 1, "_id.categoria": 1}}


def test_contratos_analitica_f2_rechazan_resultados_invalidos():
    assert AulaCronica(edificio="A", piso=1, aula="101", total=3).total == 3
    assert CargaTecnico(
        tecnico_id="0123456789abcdef01234567",
        incidencias_activas=2,
        horas_acumuladas=3.75,
    ).horas_acumuladas == 3.75
    assert TendenciaMensual(periodo="2026-01", categoria="infraestructura", total=2).periodo == "2026-01"

    with pytest.raises(ValidationError):
        AulaCronica(edificio="A", aula="101", total=2)
    with pytest.raises(ValidationError):
        CargaTecnico(tecnico_id="invalido", incidencias_activas=1, horas_acumuladas=0)
    with pytest.raises(ValidationError):
        TendenciaMensual(periodo="01-2026", categoria="infraestructura", total=1)


def test_openapi_documenta_endpoints_y_filtros_analitica_f2():
    esquema = app.openapi()
    for ruta in (
        "/analitica/aulas-cronicas",
        "/analitica/carga-tecnicos",
        "/analitica/tendencia",
    ):
        operacion = esquema["paths"][ruta]["get"]
        assert {parametro["name"] for parametro in operacion["parameters"]} == {
            "desde",
            "hasta",
            "categoria",
        }
        assert {"200", "400", "401", "403", "429"} <= set(operacion["responses"])


@pytest.mark.asyncio
async def test_endpoints_f2_reutilizan_cache_ttl_300_y_validan_resultados(monkeypatch):
    llamadas_cache = []
    resultados = iter([
        [{"edificio": "A", "piso": 1, "aula": "101", "total": 3}],
        [{
            "tecnico_id": "0123456789abcdef01234567",
            "incidencias_activas": 2,
            "horas_acumuladas": 3.75,
        }],
        [{"periodo": "2026-10", "categoria": "infraestructura", "total": 4}],
    ])

    async def usuario_falso():
        return {"_id": "usuario-prueba", "areas": []}

    async def permisos_falsos(_usuario):
        return {"permisos": ["analitica:ver"], "alcance": "global"}

    async def sin_limite():
        return None

    async def agregar_falso(_pipeline):
        return next(resultados)

    async def cache_falsa(clave, alcance, filtros, ttl=300, *, calcular, validar=None):
        resultado = await calcular()
        assert validar is not None and validar(resultado)
        llamadas_cache.append((clave, alcance, filtros, ttl))
        return resultado

    monkeypatch.setattr(security, "permisos_del_usuario", permisos_falsos)
    monkeypatch.setattr(analitica_router, "_agregar", agregar_falso)
    monkeypatch.setattr(analitica_router, "cache_analitica", cache_falsa)
    app.dependency_overrides[get_usuario_actual] = usuario_falso
    app.dependency_overrides[limite_general] = sin_limite
    habilitado = limiter.enabled
    limiter.enabled = False
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as cliente:
            respuestas = [
                await cliente.get("/analitica/aulas-cronicas"),
                await cliente.get("/analitica/carga-tecnicos"),
                await cliente.get("/analitica/tendencia"),
            ]
    finally:
        limiter.enabled = habilitado
        app.dependency_overrides.clear()

    assert [respuesta.status_code for respuesta in respuestas] == [200, 200, 200]
    assert [llamada[0] for llamada in llamadas_cache] == [
        "aulas-cronicas",
        "carga-tecnicos",
        "tendencia",
    ]
    assert all(alcance == {} and ttl == 300 for _, alcance, _, ttl in llamadas_cache)
    assert llamadas_cache[0][2]["ventana"] == "ultimos_30_dias_utc"
    assert llamadas_cache[1][2]["estados"] == _ESTADOS_ACTIVOS
    assert llamadas_cache[2][2]["agrupacion"] == "mes_categoria_utc"
