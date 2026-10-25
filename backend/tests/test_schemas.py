import os
from datetime import datetime, timedelta, timezone

import pytest
from bson import ObjectId
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

os.environ["JWT_SECRET"] = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0"
os.environ["DOMINIO_CORREO"] = "utm.edu.mx"

# La configuración de prueba debe existir antes de importar módulos que crean `settings`.
from app.core.config import Settings  # noqa: E402
from app.core.errores import registrar_manejadores_errores  # noqa: E402
from app.core.serial import a_json  # noqa: E402
from app.main import app  # noqa: E402
from app.routers.auth import LoginIn  # noqa: E402
from app.routers.usuarios import UsuarioIn, UsuarioPatch  # noqa: E402
from app.schemas.incidencia import (  # noqa: E402
    TRANSICIONES,
    EntradaHistorialOut,
    IncidenciaIn,
    SeguimientoIn,
    normalizar_tag,
)
from app.schemas.rol import RolIn  # noqa: E402

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
    d = {
        "categoria": "academico",
        "plataforma": "lms",
        "codigo_curso": "MAT-101",
        "periodo": "2026-1",
        "estudiantes_impactados": 3,
        "vlan": 10,
    }
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


def _usuario(**cambios):
    datos = {
        "nombre": "Usuario Institucional",
        "correo": "usuario@utm.edu.mx",
        "password": "Contrasena-Segura1",
        "rol": "reportante",
    }
    datos.update(cambios)
    return datos


@pytest.mark.parametrize(
    ("modelo", "datos"),
    [
        (UsuarioIn, {**_usuario(), "desconocido": True}),
        (UsuarioPatch, {"nombre": "Nombre válido", "desconocido": True}),
        (
            RolIn,
            {
                "clave": "auditor",
                "nombre": "Auditor",
                "permisos": ["incidencias:ver"],
                "alcance": "propio",
                "desconocido": True,
            },
        ),
        (LoginIn, {"correo": "usuario@utm.edu.mx", "password": "secreto", "desconocido": True}),
    ],
)
def test_modelos_extra_forbid(modelo, datos):
    with pytest.raises(ValidationError) as error:
        modelo.model_validate(datos)
    assert any(e["type"] == "extra_forbidden" for e in error.value.errors())


def test_modelos_estrictos_aceptan_entradas_validas_y_opcionales():
    assert UsuarioIn(**_usuario()).correo == "usuario@utm.edu.mx"
    assert UsuarioPatch().model_dump(exclude_none=True) == {}
    rol = RolIn(clave="auditor", nombre="Auditor", permisos=["incidencias:ver"], alcance="propio")
    assert rol.permisos == ["incidencias:ver"]
    assert LoginIn(correo="usuario@utm.edu.mx", password="secreto").correo == "usuario@utm.edu.mx"


@pytest.mark.parametrize("horas", [0, 0.25, 0.5, 1.75, 24])
def test_horas_paso_025_acepta_multiplos(horas):
    assert SeguimientoIn(estado_nuevo="en_proceso", comentario="Avance válido", horas=horas).horas == horas


@pytest.mark.parametrize("horas", [0.1, 1.1, 2.3, 24.25, -0.25, float("nan"), float("inf"), float("-inf")])
def test_horas_paso_025_rechaza_valores_invalidos(horas):
    with pytest.raises(ValidationError):
        SeguimientoIn(estado_nuevo="en_proceso", comentario="Avance válido", horas=horas)


def test_correo_dominio_y_normalizacion():
    assert UsuarioIn(**_usuario(correo="  USUARIO@UTM.EDU.MX ")).correo == "usuario@utm.edu.mx"
    assert LoginIn(correo=" ADMIN@UTM.LOCAL ", password="secreto").correo == "admin@utm.local"
    for correo in ("usuario@example.com", "usuario@evilutm.edu.mx", "usuario@sub.utm.edu.mx", "correo-mal-formado"):
        with pytest.raises(ValidationError):
            UsuarioIn(**_usuario(correo=correo))
        with pytest.raises(ValidationError):
            LoginIn(correo=correo, password="secreto")
    with pytest.raises(ValidationError):
        UsuarioIn(**_usuario(correo=f"{'a' * 244}@utm.edu.mx"))


def test_retirada_solo_es_valida_en_salidas_de_historial():
    with pytest.raises(ValidationError):
        SeguimientoIn(estado_nuevo="retirada", comentario="Intento no permitido", horas=0)
    entrada = EntradaHistorialOut(
        fecha=datetime.now(timezone.utc),
        usuario_id=str(ObjectId()),
        estado_nuevo="retirada",
        comentario="Reporte retirado por su reportante",
        horas=0,
    )
    assert entrada.estado_nuevo == "retirada"


def test_configuracion_dominio_correo():
    configuracion = Settings(
        _env_file=None,
        jwt_secret="x" * 32,
        dominio_correo=" E2E.LOCAL ",
    )
    assert configuracion.dominio_correo == "e2e.local"
    with pytest.raises(ValidationError):
        Settings(_env_file=None, jwt_secret="x" * 32, dominio_correo="https://utm.edu.mx")


def test_a_json_objectid_fechas_y_campos_sensibles():
    oid = ObjectId()
    utc = datetime(2026, 10, 22, 17, 30, 0, 123456, tzinfo=timezone.utc)
    local = datetime(2026, 10, 22, 11, 30, tzinfo=timezone(timedelta(hours=-6)))
    convertido = a_json({"_id": oid, "fecha": utc, "anidado": [{"fecha": local, "password_hash": "secreto"}]})
    assert convertido == {
        "_id": str(oid),
        "fecha": "2026-10-22T17:30:00.123456Z",
        "anidado": [{"fecha": "2026-10-22T17:30:00Z"}],
    }
    with pytest.raises(ValueError):
        a_json(datetime(2026, 10, 22, 17, 30))


def test_openapi_refleja_contratos_estrictos():
    esquemas = app.openapi()["components"]["schemas"]
    for nombre in ("UsuarioIn", "UsuarioPatch", "RolIn", "LoginIn"):
        assert esquemas[nombre]["additionalProperties"] is False
    assert esquemas["SeguimientoIn"]["properties"]["horas"]["multipleOf"] == 0.25
    assert esquemas["SeguimientoIn"]["properties"]["horas"]["maximum"] == 24
    assert "utm\\.edu\\.mx" in esquemas["UsuarioIn"]["properties"]["correo"]["pattern"]


def test_usuario_extra_devuelve_http_400_con_formato_t016():
    aplicacion = FastAPI()
    registrar_manejadores_errores(aplicacion)

    @aplicacion.post("/usuarios")
    async def _crear_usuario(datos: UsuarioIn):
        return datos

    respuesta = TestClient(aplicacion).post("/usuarios", json={**_usuario(), "campo_desconocido": "valor"})
    assert respuesta.status_code == 400
    assert respuesta.json() == {
        "error": "validacion",
        "detalle": [
            {
                "type": "extra_forbidden",
                "loc": ["body", "campo_desconocido"],
                "msg": "Campo no permitido",
            }
        ],
    }
