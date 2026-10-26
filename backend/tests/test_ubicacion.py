import csv
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

os.environ["JWT_SECRET"] = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0"

from app.core.ubicacion import generar_id_aula, id_aula_valido, resolver_ubicacion
from app.schemas.aula import AulaResueltaOut
from scripts.generar_qr_aulas import AulaQR, construir_url, generar_qr, leer_aulas_csv
from scripts.init_db import esquema_aulas

ID_VALIDO = "AbCdEfGhIjKlMnOpQrStUv"


class ColeccionAulas:
    def __init__(self, documento=None):
        self.documento = documento
        self.consultas = []

    async def find_one(self, filtro, proyeccion):
        self.consultas.append((filtro, proyeccion))
        return self.documento if filtro.get("id_publico") == ID_VALIDO else None


class BaseFalsa:
    def __init__(self, documento=None):
        self.aulas = ColeccionAulas(documento)


@pytest.mark.asyncio
async def test_resolver_ubicacion_id_valido():
    esperado = {"id_publico": ID_VALIDO, "edificio": "A", "piso": 2, "aula": "A-201"}
    base = BaseFalsa(esperado)
    assert await resolver_ubicacion(ID_VALIDO, base) == esperado
    assert base.aulas.consultas[0][0] == {"id_publico": ID_VALIDO, "activa": True}


@pytest.mark.asyncio
async def test_resolver_ubicacion_id_invalido():
    base = BaseFalsa()
    assert await resolver_ubicacion("A-201", base) is None
    assert await resolver_ubicacion("x" * 22, base) is None
    assert base.aulas.consultas == [
        ({"id_publico": "x" * 22, "activa": True}, {"_id": 0, "id_publico": 1, "edificio": 1, "piso": 1, "aula": 1})
    ]


def test_id_opaco_y_contrato_de_salida():
    ids = {generar_id_aula() for _ in range(100)}
    assert len(ids) == 100
    assert all(id_aula_valido(valor) for valor in ids)
    AulaResueltaOut.model_validate(
        {
            "id_publico": ID_VALIDO,
            "ubicacion": {"edificio": "A", "piso": 2, "aula": "A-201"},
        }
    )
    with pytest.raises(ValidationError):
        AulaResueltaOut.model_validate(
            {
                "id_publico": "A-201",
                "ubicacion": {"edificio": "A", "piso": 2, "aula": "A-201"},
            }
        )


def test_validador_mongodb_es_estricto():
    json_schema = esquema_aulas()["$jsonSchema"]
    assert json_schema["additionalProperties"] is False
    assert set(json_schema["required"]) == {"id_publico", "edificio", "piso", "aula", "activa", "fecha_creacion"}


def _csv(ruta: Path, filas: list[dict[str, str]]) -> None:
    with ruta.open("w", encoding="utf-8", newline="") as archivo:
        escritor = csv.DictWriter(archivo, fieldnames=["id_publico", "edificio", "piso", "aula"])
        escritor.writeheader()
        escritor.writerows(filas)


def test_generador_lee_csv_controlado_y_codifica_url(tmp_path):
    ruta = tmp_path / "aulas.csv"
    _csv(ruta, [{"id_publico": ID_VALIDO, "edificio": "A", "piso": "2", "aula": "A-201"}])
    assert leer_aulas_csv(ruta)[0].aula == "A-201"
    assert construir_url("https://campus.example", ID_VALIDO) == (f"https://campus.example/reportar?aula={ID_VALIDO}")


def test_generador_rechaza_ids_y_ubicaciones_duplicadas(tmp_path):
    ruta = tmp_path / "aulas.csv"
    fila = {"id_publico": ID_VALIDO, "edificio": "A", "piso": "2", "aula": "A-201"}
    _csv(ruta, [fila, fila])
    with pytest.raises(ValueError, match="duplicado"):
        leer_aulas_csv(ruta)


def test_generador_codifica_url_correcta_y_no_sobrescribe(tmp_path, monkeypatch):
    urls: list[str] = []

    class ImagenFalsa:
        def save(self, ruta):
            Path(ruta).touch()

    monkeypatch.setitem(sys.modules, "qrcode", SimpleNamespace(make=lambda url: (urls.append(url), ImagenFalsa())[1]))
    aula = AulaQR(ID_VALIDO, "A", 2, "A-201")
    creados = generar_qr([aula], "https://campus.example", tmp_path)

    assert urls == [f"https://campus.example/reportar?aula={ID_VALIDO}"]
    assert creados == [tmp_path / f"{ID_VALIDO}.png"]
    with pytest.raises(FileExistsError, match="sobrescribir"):
        generar_qr([aula], "https://campus.example", tmp_path)


@pytest.mark.parametrize(
    "base_url", ["http://campus.example", "https://user:secret@campus.example", "javascript:alert(1)"]
)
def test_generador_rechaza_urls_inseguras(base_url):
    with pytest.raises(ValueError):
        construir_url(base_url, ID_VALIDO)
