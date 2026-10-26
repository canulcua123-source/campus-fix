import json
import uuid
from datetime import datetime, timezone

import pytest

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]


def _usuario() -> dict:
    return {
        "nombre": "Usuario de auditoria",
        "correo": f"auditoria_{uuid.uuid4().hex[:10]}@e2e.local",
        "password": "Secreto-E2E-123",
        "rol": "reportante",
    }


async def _crear_usuario(api) -> dict:
    respuesta = await api.c.post("/usuarios", json=_usuario(), headers=api.h("admin"))
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()


async def test_auditoria_registra_alta_usuario(api):
    usuario = await _crear_usuario(api)

    eventos = [
        evento
        async for evento in api.db.auditoria.find(
            {"accion": "crear", "recurso": "usuarios", "recurso_id": usuario["_id"]}
        )
    ]

    assert len(eventos) == 1
    evento = eventos[0]
    assert evento["actor_id"] == api.oid("admin")
    assert evento["despues"] == {"rol": "reportante", "activo": True}
    assert "antes" not in evento
    assert evento["fecha"].tzinfo is not None


async def test_auditoria_sin_password(api):
    usuario = await _crear_usuario(api)
    evento = await api.db.auditoria.find_one({"accion": "crear", "recurso": "usuarios", "recurso_id": usuario["_id"]})

    assert evento is not None
    serializado = json.dumps(evento, default=str).lower()
    for prohibido in (
        "password",
        "password_hash",
        "contrasena",
        "secret",
        "token",
        "authorization",
        "cookie",
        "api_key",
        "secreto-e2e-123",
    ):
        assert prohibido not in serializado


async def test_auditoria_403_no_admin(api):
    respuesta = await api.c.get("/auditoria", headers=api.h("reportante_a"))
    assert respuesta.status_code == 403, respuesta.text
    assert (await api.c.get("/auditoria")).status_code == 401


async def test_auditoria_paginada(api):
    fecha = datetime(2099, 1, 1, tzinfo=timezone.utc)
    documentos = [
        {
            "actor_id": api.oid("admin"),
            "accion": "crear",
            "recurso": "roles",
            "recurso_id": f"rol_auditoria_{indice}",
            "despues": {
                "clave": f"rol_auditoria_{indice}",
                "alcance": "propio",
                "cantidad_permisos": 1,
                "sistema": False,
            },
            "fecha": fecha,
        }
        for indice in range(5)
    ]
    insertados = await api.db.auditoria.insert_many(documentos)
    esperados = [str(oid) for oid in reversed(insertados.inserted_ids)]

    primera = await api.c.get(
        "/auditoria", params={"pagina": 1, "limite": 2, "recurso": "roles"}, headers=api.h("admin")
    )
    segunda = await api.c.get(
        "/auditoria", params={"pagina": 2, "limite": 2, "recurso": "roles"}, headers=api.h("admin")
    )

    assert primera.status_code == 200, primera.text
    assert segunda.status_code == 200, segunda.text
    pagina_1 = primera.json()
    pagina_2 = segunda.json()
    assert pagina_1["pagina"] == 1 and pagina_1["limite"] == 2 and pagina_1["total"] >= 5
    assert [evento["_id"] for evento in pagina_1["resultados"]] == esperados[:2]
    assert [evento["_id"] for evento in pagina_2["resultados"]] == esperados[2:4]
    assert all(evento["recurso"] == "roles" for evento in pagina_1["resultados"] + pagina_2["resultados"])

    for parametros in (
        {"pagina": 0},
        {"limite": 101},
        {"recurso": "$ne"},
    ):
        respuesta = await api.c.get("/auditoria", params=parametros, headers=api.h("admin"))
        assert respuesta.status_code == 400, respuesta.text
