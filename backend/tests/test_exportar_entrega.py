import copy
from collections import Counter
from datetime import datetime, timedelta, timezone

import pytest
from bson import ObjectId, json_util

from scripts.exportar_entrega import (
    BASE_ENTREGA,
    OPCIONES_EJSON,
    USUARIO_SINTETICO_ID,
    _expresion_ejson,
    _indice_a_documento,
    construir_contexto,
    construir_json_incidencias,
    construir_script_maestro,
    generar_entrega,
    validar_json_entrega,
    validar_script_maestro,
    validar_uri_exportacion_local,
)


def _referencia() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def test_generacion_offline_crea_artefactos_validos_y_reproducibles(tmp_path):
    referencia = _referencia()
    script = tmp_path / "script_maestro.js"
    datos = tmp_path / "incidencias_campus.json"

    generar_entrega(referencia, ruta_script=script, ruta_json=datos)
    primera_ejecucion = (script.read_bytes(), datos.read_bytes())
    generar_entrega(referencia, ruta_script=script, ruta_json=datos)

    assert primera_ejecucion == (script.read_bytes(), datos.read_bytes())
    documentos = json_util.loads(datos.read_text(encoding="utf-8"), json_options=OPCIONES_EJSON)
    assert len(documentos) == 24
    assert Counter(documento["categoria"] for documento in documentos) == {
        "computo_redes": 8,
        "infraestructura": 8,
        "academico": 8,
    }
    assert all(isinstance(documento["_id"], ObjectId) for documento in documentos)
    assert all(documento["reportante"]["usuario_id"] == USUARIO_SINTETICO_ID for documento in documentos)
    assert all(documento["demo"] is True for documento in documentos)
    assert all(documento.get("fecha_resolucion", referencia) >= referencia - timedelta(days=60) for documento in documentos)


def test_script_incluye_definiciones_canonicas_seguridad_y_requisitos():
    contexto = construir_contexto(_referencia())
    script = construir_script_maestro(contexto)

    validar_script_maestro(script, contexto)
    assert _expresion_ejson(contexto.esquemas) in script
    assert _expresion_ejson([_indice_a_documento(indice) for indice in contexto.indices]) in script
    assert {indice.coleccion for indice in contexto.indices} == {
        "incidencias_campus",
        "usuarios",
        "roles",
        "categorias",
        "aulas",
    }
    assert any(indice.opciones.get("expireAfterSeconds") == 5_184_000 for indice in contexto.indices)
    assert any(
        indice.opciones.get("name") == "texto_titulo_descripcion"
        and indice.opciones.get("weights") == {"titulo": 10, "descripcion": 5}
        and indice.opciones.get("default_language") == "spanish"
        for indice in contexto.indices
    )
    assert "db.getCollectionNames().length === 0" in script
    assert "BASE_ESPERADA" in script
    assert "FIXTURE_NO_UTILIZABLE_T013" in script
    assert "$argon2" not in script
    assert "$2b$" not in script
    assert "dropDatabase" not in script
    assert "deleteMany" not in script


def test_json_extended_cumple_privacidad_y_reconstruye_tipos_bson():
    contexto = construir_contexto(_referencia())
    contenido = construir_json_incidencias(contexto)

    documentos = validar_json_entrega(contenido)

    assert isinstance(documentos[0]["_id"], ObjectId)
    assert isinstance(documentos[0]["fecha_creacion"], datetime)
    assert documentos[0]["fecha_creacion"].utcoffset() == timedelta(0)
    assert "password" not in contenido.lower()
    assert "secret" not in contenido.lower()
    assert "@" not in contenido


@pytest.mark.parametrize(
    "uri",
    [
        "mongodb+srv://cluster.example/utm_desk_entrega",
        "mongodb://servidor.example:27017/utm_desk_entrega",
        "mongodb://127.0.0.1:27017/utm_desk",
        "mongodb://usuario:clave@127.0.0.1:27017/utm_desk_entrega",
    ],
)
def test_exportacion_local_rechaza_destinos_inseguros(uri):
    with pytest.raises(ValueError):
        validar_uri_exportacion_local(uri)


@pytest.mark.parametrize(
    "uri",
    [
        f"mongodb://localhost:27017/{BASE_ENTREGA}",
        f"mongodb://127.0.0.1:27017/{BASE_ENTREGA}",
        f"mongodb://[::1]:27017/{BASE_ENTREGA}",
    ],
)
def test_exportacion_local_acepta_loopback_explicito(uri):
    validar_uri_exportacion_local(uri)


def test_validacion_rechaza_json_corrupto_categoria_faltante_y_dato_sensible():
    contexto = construir_contexto(_referencia())

    with pytest.raises(ValueError, match="Extended JSON válido"):
        validar_json_entrega("[")

    sin_categoria = copy.deepcopy(contexto.incidencias)
    for documento in sin_categoria:
        if documento["categoria"] == "academico":
            documento["categoria"] = "computo_redes"
    with pytest.raises(ValueError, match="distribución 8/8/8"):
        validar_json_entrega(json_util.dumps(sin_categoria, json_options=OPCIONES_EJSON))

    comprometidos = copy.deepcopy(contexto.incidencias)
    comprometidos[0]["password"] = "dato-prohibido"
    with pytest.raises(ValueError, match="términos sensibles"):
        validar_json_entrega(json_util.dumps(comprometidos, json_options=OPCIONES_EJSON))


def test_validacion_rechaza_operacion_faltante_y_esquema_desactualizado():
    contexto = construir_contexto(_referencia())
    script = construir_script_maestro(contexto)

    sin_pull = script.replace("$pull", "operador_ausente")
    with pytest.raises(ValueError, match="elementos obligatorios"):
        validar_script_maestro(sin_pull, contexto)

    esquemas_antiguos = copy.deepcopy(contexto.esquemas)
    esquemas_antiguos["usuarios"]["$jsonSchema"]["required"].remove("schema_version")
    desactualizado = script.replace(_expresion_ejson(contexto.esquemas), _expresion_ejson(esquemas_antiguos))
    with pytest.raises(ValueError, match="no coinciden con init_db.py"):
        validar_script_maestro(desactualizado, contexto)


def test_modo_local_exige_uri_antes_de_invocar_herramientas(tmp_path):
    with pytest.raises(ValueError, match="--uri-local"):
        generar_entrega(
            _referencia(),
            modo="exportacion-local",
            ruta_script=tmp_path / "script.js",
            ruta_json=tmp_path / "datos.json",
        )
