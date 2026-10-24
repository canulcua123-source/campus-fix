import os

import pytest
from pydantic import ValidationError

os.environ["JWT_SECRET"] = "0" * 64

from app.dominio.categorias import (  # noqa: E402
    es_categoria_sistema,
    normalizar_clave_categoria,
    normalizar_nombre_campo,
)
from app.schemas.categoria import (  # noqa: E402
    CampoCategoria,
    CategoriaIn,
    CategoriaOut,
    CategoriaPatch,
)
from scripts.init_db import categorias_sistema, esquema_categorias  # noqa: E402


def _campo(tipo="texto", **cambios):
    campo = {"nombre": "detalle", "etiqueta": "Detalle", "tipo": tipo, "requerido": True}
    campo.update(cambios)
    return campo


def _categoria(**cambios):
    categoria = {
        "clave": "servicios_generales",
        "nombre": "Servicios generales",
        "prefijo": "SRV",
        "area_responsable": "Administración",
        "campos": [_campo()],
    }
    categoria.update(cambios)
    return categoria


def test_normaliza_claves_y_nombres_seguros():
    assert normalizar_clave_categoria("  Seguridad Física ") == "seguridad_fisica"
    assert normalizar_clave_categoria("Servicios-Médicos") == "servicios_medicos"
    assert normalizar_nombre_campo(" Nivel de Atención ") == "nivel_de_atencion"
    assert es_categoria_sistema("computo_redes")
    assert es_categoria_sistema("personalizada", sistema=True)
    assert not es_categoria_sistema("personalizada")


@pytest.mark.parametrize("nombre", ["$ne", "detalle.ip", "", "1campo", "categoria"])
def test_rechaza_nombre_de_campo_inseguro(nombre):
    with pytest.raises((ValueError, ValidationError)):
        CampoCategoria(**_campo(nombre=nombre))


@pytest.mark.parametrize(
    "campo",
    [
        _campo("texto", min=2, max=80),
        _campo("numero", min=0.5, max=99.5),
        _campo("entero", min=1, max=10),
        _campo("booleano"),
        _campo("ip"),
        _campo("lista", opciones=["mesa", "silla"]),
    ],
    ids=["texto", "numero", "entero", "booleano", "ip", "lista"],
)
def test_acepta_los_seis_tipos_nuevos(campo):
    assert CampoCategoria(**campo).tipo == campo["tipo"]


@pytest.mark.parametrize(
    "campo",
    [
        _campo("desconocido"),
        _campo("lista"),
        _campo("lista", opciones=["uno", "uno"]),
        _campo("lista", opciones=[{"$ne": ""}]),
        _campo("texto", opciones=["uno"]),
        _campo("booleano", min=0),
        _campo("ip", max=10),
        _campo("numero", min=10, max=1),
        _campo("numero", min=float("nan")),
        _campo("entero", min=1.5),
        _campo("entero", min=True),
    ],
)
def test_rechaza_configuraciones_de_campo_incompatibles(campo):
    with pytest.raises(ValidationError):
        CampoCategoria(**campo)


def test_rechaza_campos_duplicados_despues_de_normalizar():
    with pytest.raises(ValidationError):
        CategoriaIn(
            **_categoria(
                campos=[
                    _campo(nombre="Nivel de servicio"),
                    _campo(nombre="nivel-de-servicio"),
                ]
            )
        )


@pytest.mark.parametrize("reservado", ["_id", "sistema", "version", "fecha_creacion", "activa"])
def test_cliente_no_controla_metadatos(reservado):
    with pytest.raises(ValidationError):
        CategoriaIn(**_categoria(**{reservado: True}))


def test_patch_es_parcial_sin_nulos_y_rechaza_cuerpo_vacio():
    assert CategoriaPatch(nombre="  Nombre actualizado  ").model_dump(exclude_unset=True) == {
        "nombre": "Nombre actualizado"
    }
    for cuerpo in ({}, {"nombre": None}, {"clave": "otra"}, {"version": 8}):
        with pytest.raises(ValidationError):
            CategoriaPatch(**cuerpo)


def test_salida_acepta_los_tipos_historicos_de_sistema():
    for indice, categoria in enumerate(categorias_sistema(), start=1):
        salida = CategoriaOut.model_validate({"_id": str(indice) * 24, **categoria})
        assert salida.clave == categoria["clave"]
    tipos = {campo.tipo for categoria in categorias_sistema() for campo in CategoriaOut.model_validate(
        {"_id": "1" * 24, **categoria}
    ).campos}
    assert {"enum", "lista_texto"} <= tipos


def test_jsonschema_admite_catalogo_dinamico_y_legado():
    esquema = esquema_categorias()["$jsonSchema"]
    assert esquema["properties"]["clave"]["pattern"] == r"^[a-z][a-z0-9_]{2,29}$"
    assert "sistema" not in esquema["required"]
    alternativas = esquema["properties"]["campos"]["items"]["oneOf"]
    tipos = {alternativa["properties"]["tipo"]["enum"][0] for alternativa in alternativas}
    assert tipos == {"texto", "numero", "entero", "booleano", "ip", "lista", "enum", "lista_texto"}
