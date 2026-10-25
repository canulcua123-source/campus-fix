import logging
import os
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from bson import ObjectId
from fastapi import HTTPException

os.environ["JWT_SECRET"] = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0"

import app.core.auditoria as servicio_auditoria  # noqa: E402
import app.routers.auditoria as router_auditoria  # noqa: E402
import app.routers.usuarios as router_usuarios  # noqa: E402
from app.core.auditoria import (  # noqa: E402
    construir_evento_auditoria,
    registrar_auditoria,
    resumir_categoria,
    resumir_rol,
    resumir_usuario,
)
from scripts.init_db import crear_indices, esquema_auditoria  # noqa: E402


def _actor(rol: str = "admin") -> dict:
    return {
        "_id": ObjectId(),
        "rol": rol,
        "_alcance": "global",
        "_permisos": ["incidencias:crear", "usuarios:gestionar"],
    }


def test_resumenes_usan_listas_positivas_y_excluyen_secretos():
    usuario = resumir_usuario({
        "rol": "tecnico",
        "activo": True,
        "areas": ["infraestructura"],
        "correo": "privado@ejemplo.test",
        "nombre": "Persona Privada",
        "password": "secreto",
        "password_hash": "hash-secreto",
        "access_token": "token-secreto",
        "perfil": {"refresh_token": "anidado"},
    })
    rol = resumir_rol({
        "clave": "tecnico",
        "alcance": "area",
        "permisos": ["incidencias:ver", "seguimiento:registrar"],
        "sistema": True,
        "secret": "no-copiar",
    })
    categoria = resumir_categoria({
        "clave": "laboratorios",
        "version": 2,
        "activa": False,
        "prefijo": "LAB",
        "campos": [{"nombre": "password", "tipo": "texto"}],
        "sistema": False,
        "api_key": "no-copiar",
    })

    assert usuario == {"rol": "tecnico", "activo": True, "areas": ["infraestructura"]}
    assert rol == {"clave": "tecnico", "alcance": "area", "cantidad_permisos": 2, "sistema": True}
    assert categoria == {
        "clave": "laboratorios",
        "version": 2,
        "activa": False,
        "prefijo": "LAB",
        "cantidad_campos": 1,
        "sistema": False,
    }
    serializado = repr({"usuario": usuario, "rol": rol, "categoria": categoria}).lower()
    for prohibido in ("password", "hash-secreto", "token-secreto", "refresh_token", "api_key"):
        assert prohibido not in serializado


def test_construir_evento_guarda_actor_fecha_utc_y_omite_antes_en_creacion():
    actor = _actor()
    ahora = datetime(2026, 10, 24, 20, 0, tzinfo=timezone.utc)
    evento = construir_evento_auditoria(
        actor=actor,
        accion="crear",
        recurso="usuarios",
        recurso_id=str(ObjectId()),
        despues={"rol": "reportante", "activo": True, "password_hash": "prohibido"},
        ahora=ahora,
    )

    assert evento["actor_id"] == actor["_id"]
    assert evento["fecha"] == ahora
    assert evento["despues"] == {"rol": "reportante", "activo": True}
    assert "antes" not in evento
    assert "password_hash" not in repr(evento)


@pytest.mark.parametrize(
    "cambio",
    [
        {"accion": "borrar"},
        {"recurso": "incidencias"},
        {"recurso_id": ""},
        {"actor": {"_id": "no-object-id"}},
    ],
)
def test_construir_evento_rechaza_contrato_invalido(cambio):
    argumentos = {
        "actor": _actor(),
        "accion": "crear",
        "recurso": "usuarios",
        "recurso_id": str(ObjectId()),
        "despues": {"rol": "reportante", "activo": True},
        **cambio,
    }
    with pytest.raises(ValueError):
        construir_evento_auditoria(**argumentos)


@pytest.mark.asyncio
async def test_falla_de_auditoria_se_controla_y_loguea_sin_secretos(monkeypatch, caplog):
    class AuditoriaFalla:
        async def insert_one(self, documento):
            raise RuntimeError("password_hash=valor-que-no-debe-loguearse")

    monkeypatch.setattr(
        servicio_auditoria,
        "get_db",
        lambda: SimpleNamespace(auditoria=AuditoriaFalla()),
    )
    caplog.set_level(logging.WARNING, logger="app.core.auditoria")

    await registrar_auditoria(
        actor=_actor(),
        accion="crear",
        recurso="usuarios",
        recurso_id=str(ObjectId()),
        despues={"rol": "reportante", "activo": True, "password_hash": "hash-secreto"},
    )

    assert "No se pudo registrar el evento de auditoría" in caplog.text
    assert "password_hash" not in caplog.text
    assert "hash-secreto" not in caplog.text


@pytest.mark.asyncio
async def test_alta_usuario_con_auditoria_caida_conserva_respuesta_exitosa(monkeypatch, caplog):
    insertado = ObjectId()

    class RolesFalsos:
        async def find_one(self, filtro):
            return {"clave": "reportante", "permisos": ["incidencias:crear"], "alcance": "propio"}

    class UsuariosFalsos:
        documentos = []

        async def insert_one(self, documento):
            self.documentos.append(documento.copy())
            return SimpleNamespace(inserted_id=insertado)

    class AuditoriaFalla:
        llamadas = 0

        async def insert_one(self, documento):
            self.llamadas += 1
            raise RuntimeError("fallo sintético")

    db = SimpleNamespace(roles=RolesFalsos(), usuarios=UsuariosFalsos(), auditoria=AuditoriaFalla())
    monkeypatch.setattr(router_usuarios, "get_db", lambda: db)
    monkeypatch.setattr(servicio_auditoria, "get_db", lambda: db)
    monkeypatch.setattr(router_usuarios, "hashear_password", lambda _: "hash-ficticio")
    caplog.set_level(logging.WARNING, logger="app.core.auditoria")

    respuesta = await router_usuarios.crear(
        router_usuarios.UsuarioIn(
            nombre="Usuario Seguro",
            correo="usuario@utm.edu.mx",
            password="Password-Seguro-123",
            rol="reportante",
        ),
        _actor(),
    )

    assert respuesta["_id"] == str(insertado)
    assert respuesta["rol"] == "reportante"
    assert "password" not in respuesta and "password_hash" not in respuesta
    assert len(db.usuarios.documentos) == 1
    assert db.auditoria.llamadas == 1
    assert "No se pudo registrar el evento de auditoría" in caplog.text


def test_esquema_auditoria_es_estricto_seguro_y_sin_ttl():
    esquema = esquema_auditoria()["$jsonSchema"]

    assert set(esquema["required"]) == {
        "actor_id", "accion", "recurso", "recurso_id", "despues", "fecha",
    }
    assert esquema["additionalProperties"] is False
    assert esquema["properties"]["actor_id"] == {"bsonType": "objectId"}
    assert esquema["properties"]["fecha"] == {"bsonType": "date"}
    assert esquema["properties"]["accion"]["enum"] == ["crear", "editar"]
    assert esquema["properties"]["recurso"]["enum"] == ["usuarios", "roles", "categorias"]
    texto = repr(esquema).lower()
    assert "password" not in texto and "token" not in texto and "expireafterseconds" not in texto


class ColeccionIndicesFalsa:
    def __init__(self):
        self.llamadas = []

    async def create_index(self, claves, **opciones):
        self.llamadas.append((claves, opciones))


@pytest.mark.asyncio
async def test_indices_auditoria_cubren_orden_y_filtro_sin_ttl():
    db = SimpleNamespace(
        incidencias_campus=ColeccionIndicesFalsa(),
        usuarios=ColeccionIndicesFalsa(),
        roles=ColeccionIndicesFalsa(),
        categorias=ColeccionIndicesFalsa(),
        aulas=ColeccionIndicesFalsa(),
        auditoria=ColeccionIndicesFalsa(),
        list_collection_names=AsyncMock(return_value=["auditoria"]),
    )

    await crear_indices(db)

    assert db.auditoria.llamadas == [
        ([("fecha", -1), ("_id", -1)], {"name": "auditoria_fecha_id"}),
        (
            [("recurso", 1), ("fecha", -1), ("_id", -1)],
            {"name": "auditoria_recurso_fecha_id"},
        ),
    ]
    assert all("expireAfterSeconds" not in opciones for _, opciones in db.auditoria.llamadas)


class CursorFalso:
    def __init__(self, documentos):
        self.documentos = documentos
        self.orden = None
        self.salto = 0
        self.tope = 0

    def sort(self, orden):
        self.orden = orden
        return self

    def skip(self, salto):
        self.salto = salto
        return self

    def limit(self, tope):
        self.tope = tope
        return self

    def __aiter__(self):
        seleccion = self.documentos[self.salto:self.salto + self.tope]
        self._iterador = iter(seleccion)
        return self

    async def __anext__(self):
        try:
            return next(self._iterador)
        except StopIteration as exc:
            raise StopAsyncIteration from exc


class AuditoriaConsultaFalsa:
    def __init__(self, documentos):
        self.documentos = documentos
        self.filtro = None
        self.cursor = None

    async def count_documents(self, filtro):
        self.filtro = filtro
        return len(self.documentos)

    def find(self, filtro, proyeccion):
        self.filtro = filtro
        self.cursor = CursorFalso(self.documentos)
        return self.cursor


@pytest.mark.asyncio
async def test_consulta_admin_pagina_filtra_y_ordena(monkeypatch):
    ahora = datetime.now(timezone.utc)
    documentos = [
        {
            "_id": ObjectId(),
            "actor_id": ObjectId(),
            "accion": "crear",
            "recurso": "usuarios",
            "recurso_id": str(ObjectId()),
            "despues": {"rol": "reportante", "activo": True},
            "fecha": ahora,
        }
        for _ in range(4)
    ]
    coleccion = AuditoriaConsultaFalsa(documentos)
    monkeypatch.setattr(
        router_auditoria,
        "get_db",
        lambda: SimpleNamespace(auditoria=coleccion),
    )

    respuesta = await router_auditoria.listar_auditoria(_actor(), pagina=2, limite=2, recurso="usuarios")

    assert respuesta["pagina"] == 2 and respuesta["limite"] == 2 and respuesta["total"] == 4
    assert len(respuesta["resultados"]) == 2
    assert coleccion.filtro == {"recurso": "usuarios"}
    assert coleccion.cursor.orden == [("fecha", -1), ("_id", -1)]
    assert coleccion.cursor.salto == 2 and coleccion.cursor.tope == 2


@pytest.mark.asyncio
async def test_consulta_rechaza_no_admin_antes_de_consultar(monkeypatch):
    monkeypatch.setattr(router_auditoria, "get_db", lambda: pytest.fail("No debe consultar MongoDB"))

    with pytest.raises(HTTPException) as exc:
        await router_auditoria.listar_auditoria(_actor("coordinador"), pagina=1, limite=20)

    assert exc.value.status_code == 403
