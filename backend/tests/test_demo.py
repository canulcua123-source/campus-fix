import copy
import os
from collections import Counter
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from bson import ObjectId

os.environ["JWT_SECRET"] = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0"
os.environ["MONGODB_URI"] = "mongodb://localhost:27017"
os.environ["MONGODB_ADMIN_URI"] = ""
os.environ["MONGODB_DB"] = "utm_desk_test"

from scripts.init_db import (  # noqa: E402
    CANTIDAD_INCIDENCIAS_DEMO,
    es_uri_mongodb_local,
    generar_documentos_demo,
    sembrar_demo,
)
from scripts import verificar_demo as modulo_verificador  # noqa: E402
from scripts.verificar_demo import (  # noqa: E402
    _configuracion_local,
    codigo_salida,
    verificar_requisitos,
)


class ColeccionMemoria:
    def __init__(self, documentos=None):
        self.documentos = copy.deepcopy(documentos or [])
        self.filtros_borrado = []

    async def count_documents(self, filtro):
        assert filtro == {"demo": True}
        return sum(documento.get("demo") is True for documento in self.documentos)

    async def delete_many(self, filtro):
        assert filtro == {"demo": True}
        self.filtros_borrado.append(filtro)
        anteriores = len(self.documentos)
        self.documentos = [documento for documento in self.documentos if documento.get("demo") is not True]
        return SimpleNamespace(deleted_count=anteriores - len(self.documentos))

    async def insert_many(self, documentos):
        self.documentos.extend(copy.deepcopy(documentos))
        return SimpleNamespace(inserted_ids=[ObjectId() for _documento in documentos])


class BaseMemoria:
    def __init__(self, documentos=None):
        self.incidencias_campus = ColeccionMemoria(documentos)


def _admin() -> dict:
    return {"_id": ObjectId("507f1f77bcf86cd799439011"), "nombre": "Administrador Demo"}


def _por_clave(documentos: list[dict]) -> dict:
    return {resultado.clave: resultado for resultado in verificar_requisitos(documentos)}


@pytest.mark.asyncio
async def test_demo_cumple_requisitos_pdf():
    base = BaseMemoria()

    await sembrar_demo(base, _admin())

    documentos = base.incidencias_campus.documentos
    resultados = verificar_requisitos(documentos)
    assert len(documentos) == CANTIDAD_INCIDENCIAS_DEMO == 24
    assert len(resultados) == 17
    assert all(resultado.cumple for resultado in resultados), {
        resultado.clave: resultado.detalle for resultado in resultados if not resultado.cumple
    }


def test_generador_es_reproducible_y_reserva_aula_recurrente():
    referencia = datetime.now(timezone.utc).replace(microsecond=0)

    primera = generar_documentos_demo(_admin(), referencia, semilla=42)
    segunda = generar_documentos_demo(_admin(), referencia, semilla=42)

    assert primera == segunda
    ubicaciones = Counter(
        (doc["ubicacion"]["edificio"], doc["ubicacion"]["piso"], doc["ubicacion"]["aula"])
        for doc in primera
    )
    assert ubicaciones[("A", 1, "101")] >= 3
    assert Counter(doc["categoria"] for doc in primera) == {
        "computo_redes": 8,
        "infraestructura": 8,
        "academico": 8,
    }


@pytest.mark.asyncio
async def test_seed_demo_es_idempotente_y_detecta_dataset_parcial(capsys):
    base = BaseMemoria()
    await sembrar_demo(base, _admin())
    await sembrar_demo(base, _admin())
    assert len(base.incidencias_campus.documentos) == 24
    assert "demo ya sembrado" in capsys.readouterr().out

    parciales = generar_documentos_demo(_admin())[:5]
    base_parcial = BaseMemoria(parciales)
    await sembrar_demo(base_parcial, _admin())
    assert len(base_parcial.incidencias_campus.documentos) == 5
    assert "demo parcial detectado: 5/24" in capsys.readouterr().out


@pytest.mark.asyncio
async def test_reset_demo_borra_solo_documentos_marcados():
    real = {"codigo": "INC-REAL", "demo": False}
    existentes = [real, *generar_documentos_demo(_admin())[:3]]
    base = BaseMemoria(existentes)

    await sembrar_demo(base, _admin(), reiniciar=True)

    assert base.incidencias_campus.filtros_borrado == [{"demo": True}]
    assert real in base.incidencias_campus.documentos
    assert sum(doc.get("demo") is True for doc in base.incidencias_campus.documentos) == 24


@pytest.mark.parametrize(
    ("alterar", "criterio"),
    [
        (lambda docs: docs.__setitem__(slice(None), docs[:10]), "cantidad"),
        (lambda docs: docs[0].__setitem__("descripcion", None), "sin_nulos"),
        (lambda docs: docs[0]["detalle_especifico"].__setitem__("campo_ajeno", True), "polimorfismo"),
        (lambda docs: [doc.__setitem__("evidencias_adjuntas", []) for doc in docs], "evidencias"),
    ],
)
def test_verificador_detecta_datos_invalidos(alterar, criterio):
    documentos = generar_documentos_demo(_admin())
    alterar(documentos)
    resultados = _por_clave(documentos)
    assert not resultados[criterio].cumple
    assert codigo_salida(list(resultados.values())) == 1


def test_verificador_detecta_ausencia_de_aula_recurrente():
    documentos = generar_documentos_demo(_admin())
    for indice, documento in enumerate(documentos):
        documento["ubicacion"] = {
            "edificio": ("A", "B", "C", "Biblioteca", "Laboratorios")[indice % 5],
            "piso": 1,
            "aula": str(100 + indice),
        }

    assert not _por_clave(documentos)["aula_recurrente"].cumple


def test_codigo_salida_es_cero_solo_si_todo_cumple():
    resultados = verificar_requisitos(generar_documentos_demo(_admin()))
    assert codigo_salida(resultados) == 0
    assert codigo_salida([]) == 1


def test_verificador_rechaza_uri_remota(monkeypatch):
    monkeypatch.setenv("MONGODB_DEMO_URI", "mongodb://servidor-remoto.example:27017")
    with pytest.raises(ValueError, match="solo admite MongoDB local"):
        _configuracion_local()


def test_reset_demo_solo_admite_uri_local():
    assert es_uri_mongodb_local("mongodb://localhost:27017")
    assert es_uri_mongodb_local("mongodb://127.0.0.1:27017")
    assert not es_uri_mongodb_local("mongodb://servidor-remoto.example:27017")
    assert not es_uri_mongodb_local("mongodb+srv://cluster.example")


def test_cli_informa_resultado_y_codigos_de_salida(monkeypatch, capsys):
    async def obtener_validos():
        return generar_documentos_demo(_admin())

    monkeypatch.setattr(modulo_verificador, "obtener_documentos_demo", obtener_validos)
    assert modulo_verificador.main() == 0
    salida = capsys.readouterr().out
    assert "✔ Cantidad de incidencias: 24" in salida
    assert "RESULTADO: TODOS LOS REQUISITOS CUMPLIDOS" in salida

    async def conexion_fallida():
        raise OSError("fallo local simulado")

    monkeypatch.setattr(modulo_verificador, "obtener_documentos_demo", conexion_fallida)
    assert modulo_verificador.main() == 2
    assert "no fue posible consultar MongoDB local" in capsys.readouterr().out
