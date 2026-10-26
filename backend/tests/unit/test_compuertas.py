from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.schemas.ia import AnalisisImagen
from app.schemas.incidencia import Ubicacion
from app.services.vision.compuertas import (
    DecisionCompuertas,
    EntradaCompuertas,
    UbicacionCompuertas,
    evaluar_compuertas,
    mapeo_valido,
)

AHORA = datetime(2026, 10, 26, 12, tzinfo=timezone.utc)


def _analisis(**cambios) -> AnalisisImagen:
    datos = {
        "es_incidencia_valida": True,
        "categoria": "infraestructura",
        "titulo": "Luminaria fundida",
        "descripcion": "Se observa una luminaria apagada en el aula.",
        "prioridad_sugerida": "baja",
        "tags": ["luminaria"],
        "campos_detectados": [],
        "confianza": 0.9,
        "advertencias": [],
        "detalle_infra": {"tipo_dano": "luminaria", "riesgo_seguridad": "bajo"},
    }
    datos.update(cambios)
    return AnalisisImagen.model_validate(datos)


def _entrada(**cambios) -> EntradaCompuertas:
    datos = {
        "analisis": _analisis(),
        "ahora": AHORA,
        "ubicacion": UbicacionCompuertas(
            datos=Ubicacion(edificio="A", piso=1, aula="101"),
            fuente="qr",
            existe_en_catalogo=True,
        ),
        "esquema_valido": True,
        "duplicado": "no_encontrado",
        "permisos": frozenset({"ia:usar", "incidencias:crear", "evidencias:subir"}),
        "cupo_agentico_disponible": True,
        "modo_agentico_habilitado": True,
    }
    datos.update(cambios)
    return EntradaCompuertas.model_validate(datos)


CASOS_FALLO = [
    ("G1", {"analisis": _analisis(es_incidencia_valida=False)}, "formulario"),
    (
        "G2",
        {"analisis": _analisis(categoria="no_determinada", detalle_infra=None)},
        "formulario",
    ),
    ("G3", {"analisis": _analisis(confianza=0.84)}, "formulario"),
    ("G4", {"analisis": _analisis(advertencias=["Foto borrosa"])}, "formulario"),
    ("G4", {"calidad_cliente": ("nitidez_baja",)}, "formulario"),
    (
        "G5",
        {
            "ubicacion": UbicacionCompuertas(
                datos=Ubicacion(edificio="A", piso=1, aula="101"),
                fuente="ia",
                existe_en_catalogo=True,
            )
        },
        "formulario",
    ),
    (
        "G6",
        {"analisis": _analisis(detalle_infra={"tipo_dano": "luminaria", "riesgo_seguridad": "alto"})},
        "formulario",
    ),
    ("G7", {"esquema_valido": False}, "formulario"),
    ("G8", {"duplicado": "probable"}, "duplicado"),
    ("G9", {"modo_agentico_habilitado": False}, "formulario"),
]


def test_todas_las_compuertas_permiten_agentico():
    decision = evaluar_compuertas(_entrada())
    assert decision.accion == "agentico"
    assert decision.motivos == ()
    assert [resultado.id for resultado in decision.compuertas] == [f"G{i}" for i in range(1, 10)]
    assert all(resultado.paso and resultado.motivo for resultado in decision.compuertas)


@pytest.mark.parametrize("compuerta,cambios,accion", CASOS_FALLO)
def test_cada_compuerta_falla_de_forma_independiente(compuerta, cambios, accion):
    decision = evaluar_compuertas(_entrada(**cambios))
    assert decision.accion == accion
    assert [resultado.id for resultado in decision.compuertas if not resultado.paso] == [compuerta]
    assert decision.motivos == tuple(r.motivo for r in decision.compuertas if not r.paso)
    assert all(motivo.strip() and "_id" not in motivo for motivo in decision.motivos)


def test_duplicado_tiene_precedencia_y_motivos_conservan_orden():
    decision = evaluar_compuertas(
        _entrada(
            analisis=_analisis(confianza=0.2, advertencias=["oscura"]),
            ubicacion=None,
            esquema_valido=False,
            duplicado="probable",
            permisos=frozenset(),
        )
    )
    assert decision.accion == "duplicado"
    assert [r.id for r in decision.compuertas if not r.paso] == ["G3", "G4", "G5", "G7", "G8", "G9"]


def test_estado_no_verificable_degrada_a_formulario():
    decision = evaluar_compuertas(_entrada(duplicado="no_verificable"))
    assert decision.accion == "formulario"
    assert [r.id for r in decision.compuertas if not r.paso] == ["G8"]


def test_determinismo():
    entrada = _entrada(analisis=_analisis(advertencias=["falta contexto"]), esquema_valido=False)
    assert evaluar_compuertas(entrada) == evaluar_compuertas(entrada)


def test_datos_ausentes_o_invalidos_se_rechazan():
    with pytest.raises(ValidationError):
        EntradaCompuertas.model_validate({"analisis": _analisis(), "ahora": AHORA})
    with pytest.raises(ValidationError):
        _entrada(ahora=datetime(2026, 10, 26, 12))
    with pytest.raises(ValidationError):
        _entrada(duplicado="desconocido")


def test_acciones_fuera_del_contrato_se_rechazan():
    valida = evaluar_compuertas(_entrada())
    with pytest.raises(ValidationError):
        DecisionCompuertas(
            accion="autollenar",
            motivos=valida.motivos,
            compuertas=valida.compuertas,
        )


def test_solo_el_caso_correcto_produce_agentico():
    decisiones = [evaluar_compuertas(_entrada())]
    decisiones.extend(evaluar_compuertas(_entrada(**cambios)) for _, cambios, _ in CASOS_FALLO)
    assert [decision.accion for decision in decisiones].count("agentico") == 1


def test_g7_usa_el_mapeo_determinista():
    ubicacion = _entrada().ubicacion
    assert mapeo_valido(_analisis(), ubicacion) is True
    assert mapeo_valido(_analisis(), None) is False
    assert mapeo_valido(_analisis(categoria="academico", detalle_infra=None), ubicacion) is False
