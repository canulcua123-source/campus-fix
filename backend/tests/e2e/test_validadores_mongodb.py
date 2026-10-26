import copy
import uuid
from datetime import datetime, timezone

import pytest
from pymongo.errors import WriteError

from scripts.migrar_admin_t008 import migrar_usuarios
from scripts.init_db import (
    asegurar_coleccion,
    categorias_sistema,
    esquema_categorias,
    esquema_roles,
    esquema_usuarios,
    sembrar_base,
)

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]


def _usuario(**cambios) -> dict:
    sufijo = uuid.uuid4().hex[:12]
    doc = {
        "schema_version": 1,
        "correo": f"validador_{sufijo}@e2e.local",
        "nombre": "Usuario Validador",
        "password_hash": "$argon2id$hash-de-prueba",
        "rol": "reportante",
        "activo": True,
        "fecha_alta": datetime.now(timezone.utc),
    }
    doc.update(cambios)
    return doc


def _rol(**cambios) -> dict:
    doc = {
        "clave": "rol_" + uuid.uuid4().hex[:10].translate(str.maketrans("0123456789", "ghijklmnop")),
        "nombre": "Rol de prueba",
        "descripcion": "Creado para comprobar el validador MongoDB",
        "permisos": ["incidencias:ver"],
        "alcance": "propio",
        "sistema": False,
    }
    doc.update(cambios)
    return doc


async def test_usuario_valido_aceptado(api):
    resultado = await api.db.usuarios.insert_one(_usuario(areas=["academico"], tipo_reportante="docente"))
    assert resultado.inserted_id is not None


async def test_usuario_invalido_rechazado_por_validador(api):
    doc = _usuario()
    del doc["nombre"]
    with pytest.raises(WriteError):
        await api.db.usuarios.insert_one(doc)


async def test_usuario_tipo_bson_incorrecto_rechazado(api):
    with pytest.raises(WriteError):
        await api.db.usuarios.insert_one(_usuario(activo="true"))


async def test_usuario_schema_version_invalido_rechazado(api):
    with pytest.raises(WriteError):
        await api.db.usuarios.insert_one(_usuario(schema_version=2))


async def test_usuario_fecha_alta_incorrecta_rechazada(api):
    with pytest.raises(WriteError):
        await api.db.usuarios.insert_one(_usuario(fecha_alta="2026-10-22T12:00:00Z"))


async def test_rol_valido_aceptado(api):
    resultado = await api.db.roles.insert_one(_rol(permisos=["incidencias:ver", "incidencias:buscar"]))
    assert resultado.inserted_id is not None


async def test_rol_permiso_invalido_rechazado(api):
    with pytest.raises(WriteError):
        await api.db.roles.insert_one(_rol(permisos=["permiso:inventado"]))


async def test_rol_permisos_duplicados_rechazados(api):
    with pytest.raises(WriteError):
        await api.db.roles.insert_one(_rol(permisos=["incidencias:ver", "incidencias:ver"]))


async def test_categoria_valida_aceptada(api):
    categoria = copy.deepcopy(categorias_sistema()[0])
    try:
        resultado = await api.db.categorias.update_one(
            {"clave": categoria["clave"]},
            {"$set": {"nombre": "Cómputo y redes E2E", "campos": categoria["campos"]}},
        )
        assert resultado.modified_count == 1
    finally:
        await api.db.categorias.update_one(
            {"clave": categoria["clave"]},
            {"$set": {"nombre": categoria["nombre"], "campos": categoria["campos"]}},
        )


async def test_categoria_campos_invalidos_rechazados(api):
    with pytest.raises(WriteError):
        await api.db.categorias.update_one(
            {"clave": "infraestructura"},
            {"$set": {"campos": [{"nombre": "tipo_dano", "tipo": "enum", "requerido": True}]}},
        )


async def _opciones_coleccion(db, nombre: str) -> dict:
    respuesta = await db.command({"listCollections": 1, "filter": {"name": nombre}})
    return respuesta["cursor"]["firstBatch"][0]["options"]


@pytest.mark.parametrize("nombre", ["usuarios", "roles", "categorias"])
async def test_validador_es_estricto_y_rechaza_errores(api, nombre):
    opciones = await _opciones_coleccion(api.db, nombre)
    assert opciones["validationLevel"] == "strict"
    assert opciones["validationAction"] == "error"
    assert "$jsonSchema" in opciones["validator"]


async def test_inicializacion_es_idempotente(api):
    esquemas = {
        "usuarios": esquema_usuarios(),
        "roles": esquema_roles(),
        "categorias": esquema_categorias(),
    }
    antes = {
        nombre: {
            "cantidad": await api.db[nombre].count_documents({}),
            "validador": (await _opciones_coleccion(api.db, nombre))["validator"],
        }
        for nombre in esquemas
    }
    admin_antes = await api.db.usuarios.find_one({"correo": "admin@utm.local"})

    for _ in range(2):
        for nombre, esquema in esquemas.items():
            await asegurar_coleccion(api.db, nombre, esquema)
        await sembrar_base(api.db)

    admin_despues = await api.db.usuarios.find_one({"correo": "admin@utm.local"})
    assert admin_despues["_id"] == admin_antes["_id"]
    assert admin_despues["password_hash"] == admin_antes["password_hash"]
    for nombre in esquemas:
        opciones = await _opciones_coleccion(api.db, nombre)
        assert await api.db[nombre].count_documents({}) == antes[nombre]["cantidad"]
        assert opciones["validator"] == antes[nombre]["validador"] == esquemas[nombre]


async def test_migracion_lleva_a_todos_los_usuarios_al_esquema_y_es_idempotente(api):
    antiguo = _usuario(fecha_creacion=datetime(2026, 1, 5, tzinfo=timezone.utc))
    del antiguo["schema_version"], antiguo["fecha_alta"]
    res = await api.db.usuarios.insert_one(antiguo, bypass_document_validation=True)
    try:
        assert await api.db.usuarios.count_documents({"$nor": [esquema_usuarios()]}) == 1
        assert await migrar_usuarios(api.db, aplicar=False) == 1  # simulación: no cambia nada
        assert await api.db.usuarios.count_documents({"$nor": [esquema_usuarios()]}) == 1

        assert await migrar_usuarios(api.db, aplicar=True) == 1
        assert await migrar_usuarios(api.db, aplicar=True) == 0
        migrado = await api.db.usuarios.find_one({"_id": res.inserted_id})
        assert migrado["schema_version"] == 1
        assert migrado["fecha_alta"] == datetime(2026, 1, 5, tzinfo=timezone.utc)
        assert "fecha_creacion" not in migrado
        assert await api.db.usuarios.count_documents({"$nor": [esquema_usuarios()]}) == 0
    finally:
        await api.db.usuarios.delete_one({"_id": res.inserted_id})
