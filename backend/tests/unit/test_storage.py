from typing import Annotated, Any

import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.adaptadores.storage_b2 import B2Storage
from app.dominio.puertos import StorageNoDisponibleError, StoragePort
from tests.fakes.storage import FakeStorage


class ClienteS3Falso:
    def __init__(self) -> None:
        self.firmas: list[tuple[str, dict[str, Any], int]] = []
        self.copias: list[dict[str, Any]] = []
        self.borrados: list[dict[str, Any]] = []
        self.consultas: list[dict[str, Any]] = []
        self.tamanos = {"staging/evidencia.pdf": 2048}

    def generate_presigned_url(self, operacion, *, Params, ExpiresIn):
        self.firmas.append((operacion, Params, ExpiresIn))
        return f"https://firma.fake/{operacion}"

    def copy_object(self, **kwargs):
        self.copias.append(kwargs)

    def delete_object(self, **kwargs):
        self.borrados.append(kwargs)

    def head_object(self, *, Bucket, Key):
        self.consultas.append({"Bucket": Bucket, "Key": Key})
        return {"ContentLength": self.tamanos[Key]}


def test_fake_implementa_puerto_y_registra_operaciones():
    almacenamiento = FakeStorage()
    almacenamiento.tamanos["staging/a"] = 10
    assert isinstance(almacenamiento, StoragePort)
    assert almacenamiento.url_subida("staging/a", "image/png", 10).startswith("https://storage.fake/")
    assert almacenamiento.tamano_objeto("staging/a") == 10
    almacenamiento.promover("staging/a", "evidencias/a")
    assert almacenamiento.promociones == [("staging/a", "evidencias/a")]
    assert almacenamiento.tamano_objeto("evidencias/a") == 10


def test_fake_simula_almacenamiento_no_disponible():
    with pytest.raises(StorageNoDisponibleError):
        FakeStorage(no_disponible=True).url_lectura("a", "a.pdf")


def test_adaptador_es_lazy_firma_y_promueve_sin_red():
    cliente = ClienteS3Falso()
    creaciones: list[dict[str, Any]] = []

    def fabrica(servicio, **kwargs):
        creaciones.append({"servicio": servicio, **kwargs})
        return cliente

    almacenamiento = B2Storage(
        endpoint="https://s3.example.test",
        access_key_id="clave-prueba",
        secret_access_key="secreto-prueba",
        bucket="evidencias-prueba",
        region="auto",
        client_factory=fabrica,
    )
    assert creaciones == []
    assert almacenamiento.url_subida("staging/evidencia.pdf", "application/pdf", 2048).endswith("put_object")
    assert len(creaciones) == 1
    operacion, parametros, expiracion = cliente.firmas[0]
    assert operacion == "put_object"
    assert parametros["ContentType"] == "application/pdf"
    assert parametros["ContentLength"] == 2048
    assert expiracion == 300
    assert creaciones[0]["config"].signature_version == "s3v4"
    assert almacenamiento.tamano_objeto("staging/evidencia.pdf") == 2048
    assert cliente.consultas == [{"Bucket": "evidencias-prueba", "Key": "staging/evidencia.pdf"}]
    almacenamiento.promover("staging/evidencia.pdf", "evidencias/evidencia.pdf")
    assert cliente.copias[0]["CopySource"]["Key"] == "staging/evidencia.pdf"
    assert cliente.borrados == [{"Bucket": "evidencias-prueba", "Key": "staging/evidencia.pdf"}]
    assert almacenamiento.url_lectura("evidencias/evidencia.pdf", "reporte final.pdf").endswith("get_object")
    _, parametros_lectura, _ = cliente.firmas[-1]
    assert parametros_lectura["ResponseContentDisposition"].startswith("attachment;")
    assert "reporte%20final.pdf" in parametros_lectura["ResponseContentDisposition"]


def test_adaptador_sin_configuracion_falla_sin_crear_cliente():
    almacenamiento = B2Storage(
        endpoint="",
        access_key_id="",
        secret_access_key="",
        bucket="prueba",
        region="auto",
    )
    with pytest.raises(StorageNoDisponibleError):
        almacenamiento.url_subida("a", "image/png", 1)


def test_fake_storage_se_sustituye_con_dependency_overrides(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "0" * 64)
    from app.core.storage import get_storage

    api = FastAPI()

    @api.get("/archivo")
    def archivo(almacenamiento: Annotated[StoragePort, Depends(get_storage)]):
        return {"url": almacenamiento.url_lectura("evidencias/a.pdf", "a.pdf")}

    falso = FakeStorage()
    api.dependency_overrides[get_storage] = lambda: falso
    respuesta = TestClient(api).get("/archivo")

    assert respuesta.status_code == 200
    assert respuesta.json()["url"].startswith("https://storage.fake/")
    assert falso.llamadas == [("url_lectura", "evidencias/a.pdf", "a.pdf")]


def test_fachada_conserva_http_503(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "0" * 64)
    from app.core import storage

    monkeypatch.setattr(storage, "_adaptador", lambda: FakeStorage(no_disponible=True))
    with pytest.raises(HTTPException) as error:
        storage.url_subida("staging/a", "image/png", 10)

    assert error.value.status_code == 503
    assert error.value.detail == "Almacenamiento falso no disponible"
