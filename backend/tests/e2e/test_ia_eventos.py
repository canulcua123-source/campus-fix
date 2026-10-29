import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.core.config import settings
from app.schemas.ia import OfertaIAInterna
from app.services.ia_eventos import registrar_oferta, registrar_resultado_confiable

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]


def _datos(**cambios):
    datos = {
        "modo": "agentico",
        "modelo": "modelo-e2e",
        "version_prompt": "v2",
        "confianza": 0.9,
        "campos_autollenados": ["titulo", "descripcion"],
        "proveedor": "e2e",
        "categoria": "infraestructura",
        "latencia_ia_ms": 1000,
        "resultado_ia": "ok",
    }
    datos.update(cambios)
    return OfertaIAInterna.model_validate(datos)


async def _oferta(api, quien="reportante_a", **cambios):
    return await registrar_oferta(
        api.db,
        actor_id=api.oid(quien),
        secreto=settings.jwt_secret,
        datos=_datos(**cambios),
        analisis_id=uuid.uuid4().hex,
    )


async def test_ia_evento_registrado(api):
    oferta = await _oferta(api)
    respuesta = await api.c.post(
        "/ia/eventos",
        json={"analisis_id": oferta.analisis_id, "evento": "editado", "motivo": "usuario_edito"},
        headers=api.h("reportante_a"),
    )
    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json() == {
        "analisis_id": oferta.analisis_id,
        "evento": "editado",
        "registrado": True,
        "es_final": False,
    }
    documento = await api.db.ia_eventos.find_one({"analisis_id": oferta.analisis_id})
    assert documento["editado"] is True
    assert documento["evento"] == "editado"
    assert not ({"nombre", "correo", "usuario_id", "foto", "prompt", "token"} & set(documento))


async def test_un_evento_final_por_oferta(api):
    oferta = await _oferta(api)

    async def deshacer():
        return await api.c.post(
            "/ia/eventos",
            json={"analisis_id": oferta.analisis_id, "evento": "deshecho"},
            headers=api.h("reportante_a"),
        )

    primera, segunda = await asyncio.gather(deshacer(), deshacer())
    assert primera.status_code == segunda.status_code == 200
    assert sum(respuesta.json()["registrado"] for respuesta in (primera, segunda)) == 1
    documento = await api.db.ia_eventos.find_one({"analisis_id": oferta.analisis_id})
    assert documento["resultado_final"] == "deshecho"

    incompatible = await api.c.post(
        "/ia/eventos",
        json={"analisis_id": oferta.analisis_id, "evento": "fallback"},
        headers=api.h("reportante_a"),
    )
    assert incompatible.status_code == 409
    assert await api.db.ia_eventos.count_documents({"analisis_id": oferta.analisis_id}) == 1


async def test_metricas_agregadas(api):
    proveedor = f"e2e_{uuid.uuid4().hex[:10]}"
    ahora = datetime.now(timezone.utc)
    deshecha = await _oferta(
        api,
        proveedor=proveedor,
        costo_estimado_usd=0.02,
        tokens_entrada=100,
        tokens_salida=10,
        compuertas_fallidas=["G3"],
    )
    enviada = await _oferta(
        api,
        proveedor=proveedor,
        costo_estimado_usd=0.04,
        tokens_entrada=200,
        tokens_salida=20,
        latencia_ia_ms=3000,
        compuertas_fallidas=["G3", "G5"],
    )
    await registrar_resultado_confiable(
        api.db,
        analisis_id=deshecha.analisis_id,
        evento="deshecho",
        actor_id=api.oid("reportante_a"),
        secreto=settings.jwt_secret,
    )
    await api.c.post(
        "/ia/eventos",
        json={"analisis_id": enviada.analisis_id, "evento": "editado"},
        headers=api.h("reportante_a"),
    )
    await registrar_resultado_confiable(
        api.db,
        analisis_id=enviada.analisis_id,
        evento="enviado",
        actor_id=api.oid("reportante_a"),
        secreto=settings.jwt_secret,
        duracion_toque_folio_ms=20_000,
    )

    respuesta = await api.c.get(
        "/analitica/ia",
        params={
            "desde": (ahora - timedelta(days=1)).date().isoformat(),
            "hasta": ahora.date().isoformat(),
            "proveedor": proveedor,
        },
        headers=api.h("superadmin"),
    )
    assert respuesta.status_code == 200, respuesta.text
    datos = respuesta.json()
    assert datos["totales"]["ofertas"] == 2
    assert datos["tasa_deshacer"]["porcentaje"] == 50
    assert datos["tasa_edicion"]["porcentaje"] == 50
    assert datos["latencia_ia"]["p50_ms"] == 2000
    assert datos["costos"]["costo_estimado_periodo_usd"] == 0.06
    assert datos["compuertas_fallidas"] == [
        {"compuerta": "G3", "total": 2},
        {"compuerta": "G5", "total": 1},
    ]


@pytest.mark.parametrize("quien", ["tecnico_infra", "coordinador_infra", "directivo", "reportante_a", "admin"])
async def test_metricas_ia_403_no_superadmin(api, quien):
    respuesta = await api.c.get("/analitica/ia", headers=api.h(quien))
    assert respuesta.status_code == 403, respuesta.text
    assert respuesta.json()["error"] == "sin_permiso"

    superadmin = await api.c.get("/analitica/ia", headers=api.h("superadmin"))
    assert superadmin.status_code == 200, superadmin.text
    sin_sesion = await api.c.get("/analitica/ia")
    assert sin_sesion.status_code == 401
