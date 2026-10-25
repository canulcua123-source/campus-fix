import os
from typing import Any

import pytest

os.environ["JWT_SECRET"] = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0"

from scripts.init_db import (  # noqa: E402
    asegurar_coleccion,
    crear_indices,
    esquema_adhesiones_reportes,
    esquema_aulas,
    esquema_categorias,
    esquema_coincidencias_duplicados,
    esquema_huellas_reportes,
    esquema_incidencias,
    esquema_roles,
    esquema_usuarios,
)


def _congelar(valor: Any) -> Any:
    if isinstance(valor, dict):
        return tuple(sorted((clave, _congelar(contenido)) for clave, contenido in valor.items()))
    if isinstance(valor, list | tuple):
        return tuple(_congelar(elemento) for elemento in valor)
    return valor


class ColeccionFalsa:
    def __init__(self) -> None:
        self.llamadas: list[tuple[Any, dict[str, Any]]] = []
        self.definiciones: set[Any] = set()

    async def create_index(self, claves: Any, **opciones: Any) -> str:
        self.llamadas.append((claves, opciones))
        self.definiciones.add((_congelar(claves), _congelar(opciones)))
        return opciones.get("name", "indice_generado")


class BaseIndicesFalsa:
    def __init__(self) -> None:
        self.incidencias_campus = ColeccionFalsa()
        self.usuarios = ColeccionFalsa()
        self.roles = ColeccionFalsa()
        self.categorias = ColeccionFalsa()
        self.aulas = ColeccionFalsa()


class BaseEsquemaFalsa:
    def __init__(self) -> None:
        self.existentes: set[str] = set()
        self.creaciones: list[tuple[str, dict[str, Any]]] = []
        self.comandos: list[tuple[tuple[Any, ...], dict[str, Any]]] = []

    async def list_collection_names(self) -> list[str]:
        return sorted(self.existentes)

    async def create_collection(self, nombre: str, **opciones: Any) -> None:
        self.existentes.add(nombre)
        self.creaciones.append((nombre, opciones))

    async def command(self, *args: Any, **opciones: Any) -> None:
        self.comandos.append((args, opciones))


class BaseIndicesT038Falsa(BaseIndicesFalsa):
    def __init__(self) -> None:
        super().__init__()
        self.huellas_reportes = ColeccionFalsa()
        self.coincidencias_duplicados = ColeccionFalsa()
        self.adhesiones_reportes = ColeccionFalsa()

    async def list_collection_names(self) -> list[str]:
        return ["huellas_reportes", "coincidencias_duplicados", "adhesiones_reportes"]


def test_validadores_vigentes_incluyen_t007_y_t008():
    esquemas = {
        "incidencias_campus": esquema_incidencias(),
        "usuarios": esquema_usuarios(),
        "roles": esquema_roles(),
        "categorias": esquema_categorias(),
        "aulas": esquema_aulas(),
    }

    assert all("$jsonSchema" in esquema for esquema in esquemas.values())
    incidencias = esquemas["incidencias_campus"]["$jsonSchema"]
    assert "schema_version" in incidencias["required"]
    assert incidencias["properties"]["fecha_resolucion"] == {"bsonType": "date"}
    assert "retirada" in incidencias["properties"]["estado"]["enum"]
    assert "fecha_resolucion" not in incidencias["required"]
    assert esquemas["incidencias_campus"]["$expr"] == {"$eq": ["$categoria", "$detalle_especifico.categoria"]}
    assert "schema_version" in esquemas["usuarios"]["$jsonSchema"]["required"]


def test_validadores_t038_son_estrictos_y_no_guardan_pii():
    esquemas = {
        "huellas": esquema_huellas_reportes()["$jsonSchema"],
        "coincidencias": esquema_coincidencias_duplicados()["$jsonSchema"],
        "adhesiones": esquema_adhesiones_reportes()["$jsonSchema"],
    }
    for esquema in esquemas.values():
        assert esquema["additionalProperties"] is False
    assert esquemas["huellas"]["required"] == [
        "aula_id", "categoria", "sha256", "dhash", "incidencia_id", "codigo", "fecha", "elegible",
    ]
    serializado = str(esquemas).lower()
    for campo in ("nombre", "correo", "usuario_id", "reportante", "descripcion", "fotografia", "token"):
        assert campo not in serializado


@pytest.mark.asyncio
async def test_asegurar_coleccion_usa_validacion_strict_error_y_collmod():
    db = BaseEsquemaFalsa()
    validador = esquema_incidencias()

    await asegurar_coleccion(db, "incidencias_campus", validador)
    await asegurar_coleccion(db, "incidencias_campus", validador)

    assert db.creaciones == [
        (
            "incidencias_campus",
            {
                "validator": validador,
                "validationLevel": "strict",
                "validationAction": "error",
            },
        )
    ]
    assert db.comandos == [
        (
            ("collMod", "incidencias_campus"),
            {
                "validator": validador,
                "validationLevel": "strict",
                "validationAction": "error",
            },
        )
    ]


@pytest.mark.asyncio
async def test_indices_t007_y_existentes_conservan_configuracion():
    db = BaseIndicesFalsa()

    await crear_indices(db)

    assert db.incidencias_campus.llamadas == [
        (
            [("categoria", 1), ("estado", 1), ("ubicacion.edificio", 1)],
            {},
        ),
        ("fecha_resolucion", {"expireAfterSeconds": 5_184_000}),
        (
            [("titulo", "text"), ("descripcion", "text")],
            {
                "weights": {"titulo": 10, "descripcion": 5},
                "default_language": "spanish",
                "name": "texto_titulo_descripcion",
            },
        ),
        ("codigo", {"unique": True}),
        ([("reportante.usuario_id", 1), ("fecha_creacion", -1)], {}),
        ([("tecnico_asignado.usuario_id", 1), ("estado", 1)], {}),
        ([("estado", 1), ("ubicacion.edificio", 1)], {}),
        ([("fecha_creacion", -1)], {}),
    ]
    assert db.usuarios.llamadas == [("correo", {"unique": True})]
    assert db.roles.llamadas == [("clave", {"unique": True})]
    assert db.categorias.llamadas == [("clave", {"unique": True})]
    assert db.aulas.llamadas == [
        ("id_publico", {"unique": True, "name": "aulas_id_publico_unico"}),
        ([('edificio', 1), ('piso', 1), ('aula', 1)], {"unique": True, "name": "aulas_ubicacion_unica"}),
    ]


@pytest.mark.asyncio
async def test_crear_indices_repite_definiciones_sin_duplicados_incompatibles():
    db = BaseIndicesFalsa()

    await crear_indices(db)
    primera_ejecucion = list(db.incidencias_campus.llamadas)
    await crear_indices(db)

    assert db.incidencias_campus.llamadas[8:] == primera_ejecucion
    assert len(db.incidencias_campus.definiciones) == 8
    for coleccion in (db.usuarios, db.roles, db.categorias):
        assert coleccion.llamadas[1:] == coleccion.llamadas[:1]
        assert len(coleccion.definiciones) == 1
    assert db.aulas.llamadas[2:] == db.aulas.llamadas[:2]
    assert len(db.aulas.definiciones) == 2


@pytest.mark.asyncio
async def test_indices_t038_incluyen_ttl_24h_y_consulta_compuesta():
    db = BaseIndicesT038Falsa()

    await crear_indices(db)

    assert db.huellas_reportes.llamadas == [
        (
            [("aula_id", 1), ("categoria", 1), ("fecha", -1)],
            {"name": "huellas_aula_categoria_fecha"},
        ),
        ("fecha", {"expireAfterSeconds": 86_400, "name": "huellas_ttl_24h"}),
        ("incidencia_id", {"unique": True, "name": "huellas_incidencia_unica"}),
    ]
    assert db.coincidencias_duplicados.llamadas == [
        ("expira_en", {"expireAfterSeconds": 0, "name": "coincidencias_ttl"}),
        ("huella_id", {"name": "coincidencias_huella"}),
    ]
    assert db.adhesiones_reportes.llamadas == [
        (
            [("incidencia_id", 1), ("fecha", -1)],
            {"name": "adhesiones_incidencia_fecha"},
        )
    ]
