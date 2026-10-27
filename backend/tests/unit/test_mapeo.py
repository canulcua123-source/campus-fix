from copy import deepcopy
from typing import get_args

import pytest
from hypothesis import given, settings, strategies as st
from pydantic import ValidationError

from app.schemas.ia import AnalisisImagen
from app.schemas.infraestructura import RiesgoSeguridad, TipoDano
from app.schemas.incidencia import DetalleInfra, IncidenciaIn, Ubicacion
from app.services.vision.mapeo import construir_incidencia
from app.services.vision.prompt import PROMPT_SISTEMA, PROMPT_VERSION


def _analisis(
    tipo_dano: TipoDano = TipoDano.LUMINARIA,
    riesgo: RiesgoSeguridad = RiesgoSeguridad.BAJO,
    prioridad: str = "media",
    **cambios,
) -> AnalisisImagen:
    datos = {
        "es_incidencia_valida": True,
        "categoria": "infraestructura",
        "titulo": "Luminaria dañada",
        "descripcion": "Se observa una luminaria apagada en el pasillo.",
        "prioridad_sugerida": prioridad,
        "tags": ["luminaria", "pasillo"],
        "campos_detectados": [],
        "confianza": 0.9,
        "advertencias": [],
        "detalle_infra": {"tipo_dano": tipo_dano, "riesgo_seguridad": riesgo},
    }
    datos.update(cambios)
    return AnalisisImagen.model_validate(datos)


@pytest.mark.parametrize("tipo_dano", list(TipoDano))
@pytest.mark.parametrize(
    "riesgo,riesgo_esperado,prioridad,prioridad_esperada",
    [
        (RiesgoSeguridad.BAJO, RiesgoSeguridad.BAJO, "baja", "baja"),
        (RiesgoSeguridad.MEDIO, RiesgoSeguridad.MEDIO, "media", "media"),
        (RiesgoSeguridad.ALTO, RiesgoSeguridad.MEDIO, "critica", "alta"),
    ],
)
def test_tabla_mapea_todos_los_danos_y_riesgos(
    tipo_dano: TipoDano,
    riesgo: RiesgoSeguridad,
    riesgo_esperado: RiesgoSeguridad,
    prioridad: str,
    prioridad_esperada: str,
):
    salida = construir_incidencia(_analisis(tipo_dano, riesgo, prioridad), Ubicacion(edificio="A", piso=0, aula="1"))

    assert isinstance(salida, IncidenciaIn)
    assert salida.detalle_especifico.tipo_dano == tipo_dano
    assert salida.detalle_especifico.riesgo_seguridad == riesgo_esperado
    assert salida.prioridad == prioridad_esperada
    assert salida.detalle_especifico.requiere_insumos is False
    assert salida.detalle_especifico.requiere_contratista is False


@pytest.mark.parametrize(
    "ubicacion",
    [
        Ubicacion(edificio="A", aula="A-101"),
        Ubicacion(edificio="Biblioteca", piso=-1, aula="Archivo"),
        Ubicacion(edificio="Taller", piso=50, aula="Exterior"),
    ],
)
def test_conserva_ubicaciones_validas_sin_compartir_instancia(ubicacion: Ubicacion):
    salida = construir_incidencia(_analisis(), ubicacion)

    assert salida.ubicacion == ubicacion
    assert salida.ubicacion is not ubicacion


def test_acota_textos_tags_y_decisiones_reservadas():
    analisis = _analisis(
        riesgo=RiesgoSeguridad.ALTO,
        prioridad="critica",
        titulo="x",
        descripcion="corta",
        tags=["a", "Etiqueta válida", "!", "Etiqueta válida"] + [f"tag_{n}" for n in range(30)],
    )

    salida = construir_incidencia(analisis, Ubicacion(edificio="A", aula="A-101"))

    assert len(salida.titulo) >= 5
    assert len(salida.descripcion) >= 10
    assert len(salida.tags) <= 15
    assert "etiqueta_valida" in salida.tags
    assert salida.prioridad != "critica"
    assert salida.detalle_especifico.riesgo_seguridad != RiesgoSeguridad.ALTO
    requiere = {k: v for k, v in salida.detalle_especifico.model_dump().items() if k.startswith("requiere_")}
    assert requiere and all(valor is False for valor in requiere.values())


def test_detalle_infra_es_condicional_y_estricto():
    base = _analisis().model_dump(exclude={"detalle_infra"})
    with pytest.raises(ValidationError, match="obligatorio"):
        AnalisisImagen.model_validate(base)

    base["categoria"] = "academico"
    no_infra = AnalisisImagen.model_validate(base)
    assert "detalle_infra" not in no_infra.model_dump(exclude_none=True)

    with pytest.raises(ValidationError, match="solo se permite"):
        AnalisisImagen.model_validate({**base, "detalle_infra": {"tipo_dano": "luminaria", "riesgo_seguridad": "bajo"}})
    with pytest.raises(ValidationError):
        _analisis(detalle_infra={"tipo_dano": "grieta", "riesgo_seguridad": "bajo"})
    with pytest.raises(ValidationError):
        _analisis(detalle_infra={"tipo_dano": "luminaria", "riesgo_seguridad": "extremo"})
    with pytest.raises(ValidationError):
        _analisis(detalle_infra={"tipo_dano": "luminaria", "riesgo_seguridad": "bajo", "extra": True})
    with pytest.raises(ValueError, match="solo se pueden mapear"):
        construir_incidencia(no_infra, Ubicacion(edificio="A", aula="A-101"))


def test_enums_se_serializan_como_cadenas_en_json_schema_y_respuesta():
    analisis = _analisis()
    serializado = analisis.model_dump(mode="json")
    esquema = AnalisisImagen.model_json_schema()

    assert serializado["detalle_infra"] == {"tipo_dano": "luminaria", "riesgo_seguridad": "bajo"}
    assert esquema["$defs"]["TipoDano"]["enum"] == [valor.value for valor in TipoDano]
    assert esquema["$defs"]["RiesgoSeguridad"]["enum"] == [valor.value for valor in RiesgoSeguridad]


def test_prompt_v3_declara_el_contrato_cerrado():
    assert PROMPT_VERSION == "v3"
    assert "detalle_infra" in PROMPT_SISTEMA
    assert "texto_con_instrucciones" in PROMPT_SISTEMA
    for valor in (*TipoDano, *RiesgoSeguridad):
        assert valor.value in PROMPT_SISTEMA


@st.composite
def _analisis_infra_validos(draw) -> AnalisisImagen:
    return AnalisisImagen(
        es_incidencia_valida=draw(st.booleans()),
        categoria="infraestructura",
        titulo=draw(st.text(max_size=180)),
        descripcion=draw(st.text(max_size=2200)),
        prioridad_sugerida=draw(st.sampled_from(["baja", "media", "alta", "critica"])),
        tags=draw(st.lists(st.text(max_size=50), max_size=25)),
        campos_detectados=[],
        confianza=draw(st.floats(min_value=0, max_value=1, allow_nan=False)),
        advertencias=draw(st.lists(st.text(max_size=50), max_size=5)),
        detalle_infra={
            "tipo_dano": draw(st.sampled_from(tuple(TipoDano))),
            "riesgo_seguridad": draw(st.sampled_from(tuple(RiesgoSeguridad))),
        },
    )


@st.composite
def _ubicaciones_validas(draw) -> Ubicacion:
    return Ubicacion(
        edificio=draw(st.text(min_size=1, max_size=60)),
        piso=draw(st.one_of(st.none(), st.integers(min_value=-5, max_value=50))),
        aula=draw(st.text(min_size=1, max_size=60)),
    )


@settings(max_examples=150, deadline=None, derandomize=True)
@given(a=_analisis_infra_validos(), ubic=_ubicaciones_validas())
def test_propiedad_todo_analisis_infra_valido_produce_incidencia_segura(a: AnalisisImagen, ubic: Ubicacion):
    antes_a = deepcopy(a.model_dump())
    antes_ubic = deepcopy(ubic.model_dump())

    primera = construir_incidencia(a, ubic)
    segunda = construir_incidencia(a, ubic)

    assert primera == segunda
    assert IncidenciaIn.model_validate(primera.model_dump(exclude_unset=True)) == primera
    assert primera.prioridad != "critica"
    assert primera.detalle_especifico.riesgo_seguridad != RiesgoSeguridad.ALTO
    requiere = {k: v for k, v in primera.detalle_especifico.model_dump().items() if k.startswith("requiere_")}
    assert requiere and all(valor is False for valor in requiere.values())
    assert primera.ubicacion.model_dump() == antes_ubic
    assert a.model_dump() == antes_a
    assert ubic.model_dump() == antes_ubic


def test_enums_de_ia_coinciden_con_detalle_infra():
    campos = DetalleInfra.model_fields
    assert list(get_args(campos["tipo_dano"].annotation)) == [valor.value for valor in TipoDano]
    assert list(get_args(campos["riesgo_seguridad"].annotation)) == [valor.value for valor in RiesgoSeguridad]
