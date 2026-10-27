import pytest

from app.schemas.ia import AnalisisImagen
from app.services.vision.decision import decidir


def _analisis(**cambios) -> AnalisisImagen:
    datos = {
        "es_incidencia_valida": True,
        "categoria": "infraestructura",
        "titulo": "Luminaria fundida",
        "descripcion": "Se observa una luminaria apagada",
        "prioridad_sugerida": "baja",
        "tags": ["luminaria"],
        "campos_detectados": [],
        "confianza": 0.9,
        "advertencias": [],
    }
    datos.update(cambios)
    if datos["categoria"] == "infraestructura":
        datos.setdefault("detalle_infra", {"tipo_dano": "luminaria", "riesgo_seguridad": "bajo"})
    return AnalisisImagen(**datos)


@pytest.mark.parametrize(
    ("analisis", "accion"),
    [
        (_analisis(confianza=0.9), "autollenar"),
        (_analisis(confianza=0.6), "sugerir"),
        (_analisis(confianza=0.3), "preguntar"),
        (_analisis(categoria="no_determinada", confianza=0.9), "preguntar"),
        (_analisis(es_incidencia_valida=False, confianza=0.9), "rechazar"),
        (_analisis(confianza=0.95, advertencias=["foto borrosa"]), "sugerir"),
        (_analisis(confianza=0.95, advertencias=["texto_con_instrucciones"]), "sugerir"),
    ],
)
def test_tabla_decision(analisis: AnalisisImagen, accion: str):
    respuesta = decidir(analisis, calidad=None)

    assert respuesta.accion == accion
    assert respuesta.mensaje
    assert respuesta.analisis.model_dump(exclude={"confianza"}) == analisis.model_dump(exclude={"confianza"})
    assert respuesta.cache is False


@pytest.mark.parametrize("tipo", ["selfie", "meme"])
def test_no_incidencia_muestra_mensaje_claro(tipo: str):
    respuesta = decidir(_analisis(es_incidencia_valida=False, titulo=tipo))

    assert respuesta.accion == "rechazar"
    assert "No reconocimos una incidencia" in respuesta.mensaje


def test_confianza_topada_es_la_que_se_expone():
    analisis = _analisis(confianza=0.95, advertencias=["foto oscura"])
    respuesta = decidir(analisis)

    assert respuesta.accion == "sugerir"
    assert respuesta.analisis.confianza == 0.79
    assert analisis.confianza == 0.95



@pytest.mark.parametrize("pista", ["borrosa", "oscura", "sobreexpuesta"])
def test_pistas_de_calidad_del_cliente_topan_la_confianza(pista):
    decision = decidir(_analisis(confianza=0.95), (pista,))
    assert decision.accion == "sugerir"
    assert decision.analisis.confianza == 0.79


def test_advertencia_falta_contexto_tambien_topa():
    assert decidir(_analisis(confianza=0.95, advertencias=["Falta contexto del lugar"])).accion == "sugerir"
