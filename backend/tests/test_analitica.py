from datetime import datetime, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

import app.core.security as security
import app.routers.analitica as analitica_router
from app.core.limiter import limiter, limite_general
from app.core.security import get_usuario_actual
from app.main import app
from app.routers.analitica import _filtro_efectivo
from app.schemas.analitica import FiltrosAnalitica, ResumenAnalitica


def test_filtros_analitica_intervalo_utc_incluye_hasta_completo():
    filtros = FiltrosAnalitica(desde="2026-10-01", hasta="2026-10-22", categoria="infraestructura")

    assert filtros.intervalo_utc() == (
        datetime(2026, 10, 1, tzinfo=timezone.utc),
        datetime(2026, 10, 23, tzinfo=timezone.utc),
    )
    assert filtros.para_cache() == {
        "desde": "2026-10-01",
        "hasta": "2026-10-22",
        "categoria": "infraestructura",
    }


@pytest.mark.parametrize(
    "datos",
    [
        {"desde": "2026-02-30"},
        {"desde": "2026/10/22"},
        {"desde": "2026-10-22T00:00:00Z"},
        {"desde": "2026-10-23", "hasta": "2026-10-22"},
        {"categoria": "otra"},
        {"extra": "no permitido"},
    ],
)
def test_filtros_analitica_rechaza_entradas_ambiguas(datos):
    with pytest.raises(ValidationError):
        FiltrosAnalitica.model_validate(datos)


def test_resumen_analitica_exige_enteros_no_negativos():
    valido = ResumenAnalitica(abiertas=0, en_proceso=1, criticas=2, resueltas_periodo=3)
    assert valido.model_dump()["abiertas"] == 0

    with pytest.raises(ValidationError):
        ResumenAnalitica(abiertas=-1, en_proceso=0, criticas=0, resueltas_periodo=0)


def test_filtro_efectivo_no_reemplaza_alcance_con_categoria_cliente():
    alcance = {"categoria": {"$in": ["infraestructura"]}}
    filtros = FiltrosAnalitica(categoria="computo_redes", desde="2026-10-01", hasta="2026-10-22")

    filtro = _filtro_efectivo(alcance, filtros, "fecha_creacion")

    assert filtro["$and"][0] == alcance
    assert {"categoria": "computo_redes"} in filtro["$and"]
    assert {
        "fecha_creacion": {
            "$gte": datetime(2026, 10, 1, tzinfo=timezone.utc),
            "$lt": datetime(2026, 10, 23, tzinfo=timezone.utc),
        }
    } in filtro["$and"]


@pytest.mark.asyncio
async def test_endpoint_resumen_documenta_filtros_y_usa_facet(monkeypatch):
    pipelines = []

    async def usuario_falso():
        return {"_id": "usuario-prueba", "areas": []}

    async def permisos_falsos(_usuario):
        return {"permisos": ["analitica:ver"], "alcance": "global"}

    async def sin_limite():
        return None

    async def sin_cache(_clave, _alcance, _filtros, _ttl=300, *, calcular, validar=None):
        return await calcular()

    async def agregar_falso(pipeline):
        pipelines.append(pipeline)
        return [{"abiertas": 1, "en_proceso": 2, "criticas": 3, "resueltas_periodo": 4}]

    monkeypatch.setattr(security, "permisos_del_usuario", permisos_falsos)
    monkeypatch.setattr(analitica_router, "cache_analitica", sin_cache)
    monkeypatch.setattr(analitica_router, "_agregar", agregar_falso)
    app.dependency_overrides[get_usuario_actual] = usuario_falso
    app.dependency_overrides[limite_general] = sin_limite
    habilitado = limiter.enabled
    limiter.enabled = False
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as cliente:
            r = await cliente.get(
                "/analitica/resumen",
                params={"desde": "2026-10-01", "hasta": "2026-10-22", "categoria": "infraestructura"},
            )
            invalida = await cliente.get("/analitica/resumen", params={"desde": "2026-02-30"})
            duplicada = await cliente.get("/analitica/resumen?categoria=academico&categoria=infraestructura")
            inesperada = await cliente.get("/analitica/resumen", params={"otro": "valor"})
    finally:
        limiter.enabled = habilitado
        app.dependency_overrides.clear()

    assert r.status_code == 200
    assert r.json() == {"abiertas": 1, "en_proceso": 2, "criticas": 3, "resueltas_periodo": 4}
    assert pipelines[0][0]["$match"]["$and"][0] == {}
    assert "$facet" in pipelines[0][1]
    assert invalida.status_code == 400
    assert invalida.json()["error"] == "validacion"
    assert duplicada.status_code == 400
    assert duplicada.json()["error"] == "validacion"
    assert inesperada.status_code == 400
    assert inesperada.json()["error"] == "validacion"

    parametros = app.openapi()["paths"]["/analitica/resumen"]["get"]["parameters"]
    assert {parametro["name"] for parametro in parametros} == {"desde", "hasta", "categoria"}
