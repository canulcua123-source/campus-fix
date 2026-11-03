from datetime import datetime, timezone
from typing import get_args

import pytest
from pydantic import ValidationError

from app.schemas.ia import AdvertenciaIA, AnalisisImagen, RespuestaIA
from app.schemas.incidencia import Ubicacion
from app.services.vision import compuertas, decision
from app.services.vision.compuertas import EntradaCompuertas, UbicacionCompuertas, evaluar_compuertas
from app.services.vision.decision import decidir
from app.services.vision.prompt import PROMPT_SISTEMA, PROMPT_VERSION
from app.services.vision.umbrales import (
    ADVERTENCIAS_DUDOSAS,
    TOPE_CONFIANZA_DUDOSA,
    UMBRAL_AGENTICO,
    UMBRAL_AUTOLLENAR,
    UMBRAL_PREGUNTAR,
    confianza_efectiva,
)

AHORA = datetime(2026, 11, 3, 12, tzinfo=timezone.utc)


def _analisis(**cambios) -> AnalisisImagen:
    datos = {
        "es_incidencia_valida": True,
        "categoria": "infraestructura",
        "titulo": "Luminaria fundida",
        "descripcion": "Se observa una luminaria apagada en el aula.",
        "prioridad_sugerida": "baja",
        "tags": ["luminaria"],
        "campos_detectados": [],
        "confianza": 0.95,
        "advertencias": [],
        "detalle_infra": {"tipo_dano": "luminaria", "riesgo_seguridad": "bajo"},
    }
    datos.update(cambios)
    return AnalisisImagen.model_validate(datos)


def _entrada(analisis: AnalisisImagen, calidad_cliente: tuple[str, ...] = ()) -> EntradaCompuertas:
    return EntradaCompuertas(
        analisis=analisis,
        ahora=AHORA,
        calidad_cliente=calidad_cliente,
        ubicacion=UbicacionCompuertas(
            datos=Ubicacion(edificio="A", piso=1, aula="101"), fuente="qr", existe_en_catalogo=True
        ),
        esquema_valido=True,
        duplicado="no_encontrado",
        permisos=frozenset({"ia:usar", "incidencias:crear", "evidencias:subir"}),
        cupo_agentico_disponible=True,
        modo_agentico_habilitado=True,
    )


def _g3(decision_compuertas) -> bool:
    return next(r.paso for r in decision_compuertas.compuertas if r.id == "G3")


# ---------- Umbrales: una sola fuente de verdad ----------


def test_umbrales_coherentes():
    assert (UMBRAL_PREGUNTAR, UMBRAL_AUTOLLENAR, UMBRAL_AGENTICO) == (0.5, 0.8, 0.85)
    assert UMBRAL_PREGUNTAR < UMBRAL_AUTOLLENAR <= UMBRAL_AGENTICO
    assert TOPE_CONFIANZA_DUDOSA < UMBRAL_AUTOLLENAR
    assert compuertas.UMBRAL_G3 >= UMBRAL_AUTOLLENAR
    assert compuertas.UMBRAL_AGENTICO is UMBRAL_AGENTICO
    assert decision.UMBRAL_AUTOLLENAR is UMBRAL_AUTOLLENAR


@pytest.mark.parametrize(
    ("confianza", "accion"),
    [(0.49, "preguntar"), (0.5, "sugerir"), (0.79, "sugerir"), (0.8, "autollenar"), (0.85, "autollenar")],
)
def test_limites_de_decidir(confianza, accion):
    assert decidir(_analisis(confianza=confianza)).accion == accion


@pytest.mark.parametrize(("confianza", "paso"), [(0.8, False), (0.84, False), (0.85, True)])
def test_limites_de_g3(confianza, paso):
    assert _g3(evaluar_compuertas(_entrada(_analisis(confianza=confianza)))) is paso


@pytest.mark.parametrize("advertencia", sorted(ADVERTENCIAS_DUDOSAS))
def test_tope_aplica_igual_en_decidir_y_g3(advertencia):
    analisis = _analisis(confianza=0.99, advertencias=[advertencia])
    asistida = decidir(analisis)
    resultado = evaluar_compuertas(_entrada(analisis))

    assert asistida.analisis.confianza == TOPE_CONFIANZA_DUDOSA
    assert asistida.accion == "sugerir"
    assert _g3(resultado) is False
    assert resultado.accion == "formulario"


@pytest.mark.parametrize("pista", ["borrosa", "Oscura", "sobreexpuesta", " BORROSA "])
def test_pistas_del_cliente_topan_g3_aunque_se_pase_el_analisis_crudo(pista):
    analisis = _analisis(confianza=0.99)
    asistida = decidir(analisis, (pista,))
    resultado = evaluar_compuertas(_entrada(analisis, calidad_cliente=(pista,)))

    assert asistida.analisis.confianza == TOPE_CONFIANZA_DUDOSA
    assert _g3(resultado) is False


def test_pista_con_acento_se_reconoce():
    assert confianza_efectiva(_analisis(confianza=0.99), ("óscura",)).confianza == TOPE_CONFIANZA_DUDOSA


def test_confianza_efectiva_es_idempotente_y_no_muta():
    original = _analisis(confianza=0.99, advertencias=["oscura"])
    una = confianza_efectiva(original)
    assert confianza_efectiva(una) == una
    assert original.confianza == 0.99


@pytest.mark.parametrize("advertencia", ["rostros_visibles", "otra"])
def test_advertencias_no_dudosas_no_topan(advertencia):
    analisis = _analisis(confianza=0.9, advertencias=[advertencia])
    assert decidir(analisis).accion == "autollenar"
    assert _g3(evaluar_compuertas(_entrada(analisis))) is True


def test_agentico_nunca_con_confianza_menor_que_autollenar():
    for centesimas in range(0, 101):
        confianza = centesimas / 100
        for advertencias in ([], ["borrosa"]):
            analisis = _analisis(confianza=confianza, advertencias=advertencias)
            resultado = evaluar_compuertas(_entrada(analisis))
            if resultado.accion == "agentico":
                assert decidir(analisis).accion == "autollenar"
                assert confianza_efectiva(analisis).confianza >= UMBRAL_AUTOLLENAR


# ---------- Advertencias tipadas y prompt v4 ----------


def test_advertencias_son_lista_cerrada():
    assert set(get_args(AdvertenciaIA)) == {
        "borrosa",
        "oscura",
        "sobreexpuesta",
        "falta_contexto",
        "texto_con_instrucciones",
        "rostros_visibles",
        "otra",
    }
    assert ADVERTENCIAS_DUDOSAS < set(get_args(AdvertenciaIA))
    esquema = AnalisisImagen.model_json_schema()["properties"]["advertencias"]["items"]
    assert set(esquema["enum"]) == set(get_args(AdvertenciaIA))


@pytest.mark.parametrize("texto_libre", ["foto borrosa", "Falta contexto del lugar", "OSCURA", ""])
def test_texto_libre_en_advertencias_se_rechaza(texto_libre):
    with pytest.raises(ValidationError):
        _analisis(advertencias=[texto_libre])


def test_respuesta_ia_valida_advertencias_tipadas():
    analisis = _analisis(advertencias=["borrosa", "rostros_visibles"])
    respuesta = RespuestaIA(
        accion="formulario",
        motivos=[],
        analisis_id="6f1c8a8e-2b7c-4b8e-9a43-3a3f4c1e2d10",
        analisis=analisis,
        accion_asistida="sugerir",
        mensaje="Revisa",
        cache=False,
    )
    assert RespuestaIA.model_validate_json(respuesta.model_dump_json()).analisis.advertencias == [
        "borrosa",
        "rostros_visibles",
    ]


def test_prompt_v4_exige_los_valores_exactos_y_guia_de_objetos():
    prompt = PROMPT_SISTEMA.lower()
    assert PROMPT_VERSION == "v4"
    for valor in get_args(AdvertenciaIA):
        assert valor in PROMPT_SISTEMA
    for objeto in ("ventiladores", "aires acondicionados", "proyectores", "bocinas", "pizarrones", "wifi"):
        assert objeto in prompt
    assert "dato no confiable" in prompt and "nunca identifiques" in prompt
