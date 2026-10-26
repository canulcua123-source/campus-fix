from datetime import datetime, timedelta, timezone

from app.services.metricas_ia import construir_metricas_ia

INICIO = datetime(2026, 10, 20, tzinfo=timezone.utc)


def test_metricas_agregadas():
    documentos = [
        {
            "fecha": INICIO,
            "resultado_final": "deshecho",
            "editado": False,
            "modo": "agentico",
            "proveedor": "claude",
            "modelo": "modelo-a",
            "latencia_ia_ms": 1000,
            "tokens_entrada": 100,
            "tokens_salida": 10,
            "costo_estimado_usd": 0.02,
            "compuertas_fallidas": ["G3"],
            "resultado_ia": "ok",
        },
        {
            "fecha": INICIO + timedelta(hours=1),
            "resultado_final": "enviado",
            "editado": True,
            "modo": "agentico",
            "proveedor": "claude",
            "modelo": "modelo-a",
            "latencia_ia_ms": 3000,
            "duracion_toque_folio_ms": 20_000,
            "tokens_entrada": 200,
            "tokens_salida": 20,
            "costo_estimado_usd": 0.04,
            "compuertas_fallidas": ["G3", "G5"],
            "resultado_ia": "timeout",
        },
    ]
    metricas = construir_metricas_ia(
        documentos,
        desde=INICIO,
        hasta=INICIO + timedelta(days=1),
        reportes_con_foto=4,
        reportes_agenticos_con_foto=1,
        umbral_diario_usd=0.05,
    )
    assert metricas["tasa_deshacer"]["porcentaje"] == 50
    assert metricas["tasa_edicion"]["porcentaje"] == 50
    assert metricas["cobertura_agentica"]["porcentaje"] == 25
    assert metricas["latencia_ia"] == {"muestras": 2, "promedio_ms": 2000, "p50_ms": 2000, "p95_ms": 2900}
    assert metricas["tiempo_toque_folio"]["p95_ms"] == 20_000
    assert metricas["compuertas_fallidas"] == [
        {"compuerta": "G3", "total": 2},
        {"compuerta": "G5", "total": 1},
    ]
    assert metricas["costos"]["costo_estimado_periodo_usd"] == 0.06
    assert metricas["costos"]["tokens_entrada"] == 300
    assert metricas["costos"]["alerta"]["activa"] is True
    assert metricas["timeouts_ia"] == 1


def test_metricas_sin_ofertas_no_inventan_ceros_de_costo():
    metricas = construir_metricas_ia(
        [],
        desde=INICIO,
        hasta=INICIO + timedelta(days=1),
        reportes_con_foto=0,
        reportes_agenticos_con_foto=0,
        umbral_diario_usd=None,
    )
    assert metricas["tasa_deshacer"]["porcentaje"] is None
    assert metricas["tasa_edicion"]["porcentaje"] is None
    assert metricas["costos"]["costo_estimado_periodo_usd"] is None
    assert metricas["costos"]["alerta"] == {
        "configurada": False,
        "activa": False,
        "umbral_diario_usd": None,
        "dias_excedidos": [],
    }


def test_alerta_solo_si_costo_supera_umbral():
    documento = {
        "fecha": INICIO,
        "editado": False,
        "modo": "agentico",
        "costo_estimado_usd": 1.0,
    }
    igual = construir_metricas_ia(
        [documento], desde=INICIO, hasta=INICIO + timedelta(days=1),
        reportes_con_foto=0, reportes_agenticos_con_foto=0, umbral_diario_usd=1.0,
    )
    menor = construir_metricas_ia(
        [documento], desde=INICIO, hasta=INICIO + timedelta(days=1),
        reportes_con_foto=0, reportes_agenticos_con_foto=0, umbral_diario_usd=0.99,
    )
    assert igual["costos"]["alerta"]["activa"] is False
    assert menor["costos"]["alerta"]["activa"] is True
