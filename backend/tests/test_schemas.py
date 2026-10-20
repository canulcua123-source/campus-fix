import pytest
from pydantic import ValidationError

from app.schemas.incidencia import TRANSICIONES, IncidenciaIn, normalizar_tag
from app.schemas.rol import RolIn

BASE = {
    "titulo": "Sin red en laboratorio",
    "descripcion": "El switch del laboratorio no responde",
    "prioridad": "alta",
    "ubicacion": {"edificio": "A", "piso": 1, "aula": "A-101"},
    "tags": ["red"],
}


def test_computo_valido():
    d = {"categoria": "computo_redes", "ip": "10.0.0.5", "vlan": 20, "puerto_uplink": "Gi0/1", "equipos_afectados": 12}
    assert IncidenciaIn(**BASE, detalle_especifico=d).detalle_especifico.vlan == 20


def test_academico_con_vlan_falla():
    d = {"categoria": "academico", "plataforma": "lms", "codigo_curso": "MAT-101", "periodo": "2026-1",
         "estudiantes_impactados": 3, "vlan": 10}
    with pytest.raises(ValidationError):
        IncidenciaIn(**BASE, detalle_especifico=d)


def test_transiciones():
    assert "resuelta" in TRANSICIONES["en_proceso"]
    assert "cerrada" not in TRANSICIONES["abierta"]
    assert TRANSICIONES["cerrada"] == []


def test_normalizar_tag():
    assert normalizar_tag("  Aire Acondicionado ") == "aire_acondicionado"
    assert normalizar_tag("Cámara") == "camara"
    with pytest.raises(ValueError):
        normalizar_tag("a")


def test_rol_permiso_desconocido():
    with pytest.raises(ValidationError):
        RolIn(clave="demo", nombre="Demo", permisos=["incidencias:volar"], alcance="propio")
    with pytest.raises(ValidationError):
        RolIn(clave="demo", nombre="Demo", permisos=["ia:usar", "ia:usar"], alcance="propio")
