import pytest

import app.routers.ia as ia_router
from app.routers.ia import DATO_PERSONAL, _minimizar_contexto

USUARIO = {"nombre": "José María Pérez López", "correo": "jose.perez@utm.mx", "matricula": "A0123"}


def test_none_se_conserva():
    assert _minimizar_contexto(None, USUARIO) is None


def test_sin_datos_personales_solo_normaliza():
    assert _minimizar_contexto("  Proyector   del aula 101 ", USUARIO) == "Proyector del aula 101"


@pytest.mark.parametrize(
    "contexto",
    [
        "Lo reportó José María Pérez López en el pasillo",
        "Lo reportó JOSE  MARIA   PEREZ LOPEZ en el pasillo",
        "Lo reportó jose maria perez lopez en el pasillo",
        "Lo reportó José María Pérez\tLópez en el pasillo",
    ],
)
def test_nombre_completo_con_espacios_mayusculas_y_acentos(contexto):
    limpio = _minimizar_contexto(contexto, USUARIO)
    assert limpio.startswith("Lo reportó ") and limpio.endswith(" en el pasillo")
    plegado = limpio.lower()
    for parte in ("jose", "josé", "maria", "maría", "perez", "pérez", "lopez", "lópez"):
        assert parte not in plegado.split()
    assert DATO_PERSONAL in limpio


@pytest.mark.parametrize("parte", ["José", "jose", "Perez", "LÓPEZ"])
def test_nombre_o_apellido_suelto(parte):
    assert _minimizar_contexto(f"Habla con {parte} del área", USUARIO) == f"Habla con {DATO_PERSONAL} del área"


def test_limite_de_palabra_no_corta_otras_palabras():
    usuario = {"nombre": "Ana Sol", "correo": "ana@utm.mx"}
    assert _minimizar_contexto("Analizar la consola de Ana", usuario) == f"Analizar la consola de {DATO_PERSONAL}"


def test_tokens_cortos_no_se_omiten():
    usuario = {"nombre": "Li Wu", "correo": "lw@utm.mx"}
    assert _minimizar_contexto("El wifi de la sala Li falla", usuario) == "El wifi de la sala Li falla"


def test_correo_propio_y_parte_local():
    limpio = _minimizar_contexto("Escribir a JOSE.PEREZ@UTM.MX o a jose.perez por Teams", USUARIO)
    assert limpio == f"Escribir a {DATO_PERSONAL} o a {DATO_PERSONAL} por Teams"


def test_otros_correos():
    limpio = _minimizar_contexto("Avisar a maria_g+1@alumnos.utm.edu.mx por favor", USUARIO)
    assert limpio == f"Avisar a {DATO_PERSONAL} por favor"


def test_matricula():
    assert _minimizar_contexto("Mi matrícula es a0123.", USUARIO) == f"Mi matrícula es {DATO_PERSONAL}."


@pytest.mark.parametrize(
    "telefono", ["9511234567", "951 123 4567", "951-123-45-67", "+52 951 123 4567", "(951) 123.4567"]
)
def test_telefonos(telefono):
    assert _minimizar_contexto(f"Llamar al {telefono} hoy", USUARIO) == f"Llamar al {DATO_PERSONAL} hoy"


@pytest.mark.parametrize("texto", ["Aula 101 piso 2", "IP 10.0.0.1", "Extensión 1234"])
def test_numeros_cortos_se_conservan(texto):
    assert _minimizar_contexto(texto, USUARIO) == texto


def test_caracteres_especiales_del_perfil_se_escapan():
    usuario = {"nombre": "Ana (Admin) .*", "correo": "a+b@utm.mx"}
    assert _minimizar_contexto("Ana dejó la puerta abierta", usuario) == f"{DATO_PERSONAL} dejó la puerta abierta"


def test_usuario_sin_campos_personales():
    assert _minimizar_contexto("Pizarrón roto", {}) == "Pizarrón roto"


def test_clave_cache_estable_tras_minimizar():
    base = {"usuario_id": "u1", "proveedor": "p", "modelo": "m", "prompt_version": "v4"}
    a = ia_router._normalizar_contexto(_minimizar_contexto("Pérez   reporta el proyector", USUARIO))
    b = ia_router._normalizar_contexto(_minimizar_contexto("perez reporta el proyector", USUARIO))
    assert a == b
    assert ia_router._clave_cache(b"x", a, **base) == ia_router._clave_cache(b"x", b, **base)
