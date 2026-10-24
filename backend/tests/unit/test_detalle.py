import json
import os

import pytest
from pydantic import ValidationError

os.environ["JWT_SECRET"] = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0"

from app.core import cache_categorias
from app.core.cache_categorias import (
    invalidar_categoria,
    limpiar_cache_modelos,
    modelo_detalle_cacheado,
    obtener_definicion_cacheada,
)
from app.dominio.detalle import DefinicionDetalleError, construir_modelo_detalle, validar_detalle_dinamico


def _definicion(version: int = 1) -> dict:
    return {
        "clave": "servicios_medicos",
        "version": version,
        "campos": [
            {"nombre": "descripcion", "tipo": "texto", "requerido": True, "min": 2, "max": 10},
            {"nombre": "temperatura", "tipo": "numero", "requerido": True, "min": -20, "max": 80},
            {"nombre": "pacientes", "tipo": "entero", "requerido": False, "min": 1, "max": 50},
            {"nombre": "ambulancia", "tipo": "booleano", "requerido": True},
            {"nombre": "direccion_ip", "tipo": "ip", "requerido": True},
            {
                "nombre": "tipo_servicio",
                "tipo": "lista",
                "requerido": True,
                "opciones": ["consulta", "urgencia"],
            },
        ],
    }


def _detalle(**cambios) -> dict:
    datos = {
        "categoria": "servicios_medicos",
        "descripcion": "consulta",
        "temperatura": 36.5,
        "ambulancia": False,
        "direccion_ip": "2001:db8::1",
        "tipo_servicio": "consulta",
    }
    datos.update(cambios)
    return datos


def test_modelo_dinamico_tipos():
    modelo = construir_modelo_detalle(_definicion())
    salida = modelo.model_validate(_detalle(pacientes=3)).model_dump(
        mode="json", exclude_unset=True, exclude_none=True
    )
    assert salida == _detalle(pacientes=3)
    assert "pacientes" not in validar_detalle_dinamico(_definicion(), _detalle())

    invalidos = [
        _detalle(descripcion="x"),
        _detalle(descripcion="descripcion demasiado larga"),
        _detalle(temperatura="36.5"),
        _detalle(temperatura=True),
        _detalle(temperatura=float("nan")),
        _detalle(temperatura=float("inf")),
        _detalle(pacientes=1.5),
        _detalle(pacientes="3"),
        _detalle(ambulancia=1),
        _detalle(ambulancia="true"),
        _detalle(direccion_ip="999.1.1.1"),
        _detalle(tipo_servicio="desconocido"),
        _detalle(campo_extra="valor"),
        _detalle(descripcion=None),
    ]
    for invalido in invalidos:
        with pytest.raises(ValidationError):
            modelo.model_validate(invalido)

    sin_requerido = _detalle()
    del sin_requerido["descripcion"]
    with pytest.raises(ValidationError):
        modelo.model_validate(sin_requerido)

    for campo, valor in (("pacientes", 0), ("pacientes", 51), ("temperatura", 81)):
        with pytest.raises(ValidationError):
            modelo.model_validate(_detalle(**{campo: valor}))

    definicion_invalida = _definicion()
    definicion_invalida["campos"][0]["nombre"] = "$where"
    with pytest.raises(DefinicionDetalleError):
        construir_modelo_detalle(definicion_invalida)


def test_modelo_cacheado_separa_version_y_contenido():
    limpiar_cache_modelos()
    primera = _definicion()
    assert modelo_detalle_cacheado(primera) is modelo_detalle_cacheado(primera)
    assert modelo_detalle_cacheado(_definicion(2)) is not modelo_detalle_cacheado(primera)
    cambiada = _definicion()
    cambiada["campos"][0]["max"] = 9
    assert modelo_detalle_cacheado(cambiada) is not modelo_detalle_cacheado(primera)


class _RedisFalso:
    def __init__(self):
        self.datos: dict[str, str] = {}
        self.eliminadas: list[str] = []

    async def get(self, clave: str):
        return self.datos.get(clave)

    async def set(self, clave: str, valor: str, ex: int):
        assert ex == cache_categorias.TTL_DEFINICION_SEGUNDOS
        self.datos[clave] = valor

    async def delete(self, *claves: str):
        self.eliminadas.extend(claves)
        for clave in claves:
            self.datos.pop(clave, None)


@pytest.mark.asyncio
async def test_cache_definicion_hit_miss_e_invalidacion(monkeypatch):
    redis = _RedisFalso()
    monkeypatch.setattr(cache_categorias, "get_redis", lambda: redis)
    llamadas = 0

    async def cargar():
        nonlocal llamadas
        llamadas += 1
        return _definicion()["campos"]

    primera = await obtener_definicion_cacheada("servicios_medicos", 1, cargar=cargar)
    segunda = await obtener_definicion_cacheada("servicios_medicos", 1, cargar=cargar)
    assert primera == segunda
    assert llamadas == 1

    await invalidar_categoria("servicios_medicos", 1)
    assert redis.datos == {}
    assert redis.eliminadas == ["categorias:definicion:v1:servicios_medicos:1"]


@pytest.mark.asyncio
async def test_cache_corrupta_consulta_fuente(monkeypatch):
    redis = _RedisFalso()
    clave = "categorias:definicion:v1:servicios_medicos:1"
    redis.datos[clave] = json.dumps([{"nombre": "$where", "tipo": "texto", "requerido": True}])
    monkeypatch.setattr(cache_categorias, "get_redis", lambda: redis)

    async def cargar():
        return _definicion()["campos"]

    definicion = await obtener_definicion_cacheada("servicios_medicos", 1, cargar=cargar)
    assert definicion == _definicion()


@pytest.mark.asyncio
async def test_cache_redis_no_disponible_conserva_validacion(monkeypatch):
    def redis_no_disponible():
        raise RuntimeError("Redis no inicializado")

    monkeypatch.setattr(cache_categorias, "get_redis", redis_no_disponible)

    async def cargar():
        return _definicion()["campos"]

    definicion = await obtener_definicion_cacheada("servicios_medicos", 1, cargar=cargar)
    modelo = modelo_detalle_cacheado(definicion)
    assert modelo.model_validate(_detalle()).tipo_servicio == "consulta"
