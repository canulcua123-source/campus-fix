import uuid

import pytest
from bson import ObjectId

from app.core.security import crear_access_token

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]


def _u(**over):
    b = {
        "nombre": "Nuevo Usuario",
        "correo": f"nuevo_{uuid.uuid4().hex[:8]}@e2e.local",
        "password": "Contrasena-Segura1",
        "rol": "reportante",
    }
    b.update(over)
    return b


async def _crear(api, quien="admin", **over):
    return await api.c.post("/usuarios", json=_u(**over), headers=api.h(quien))


async def test_crear_usuario(api):
    r = await _crear(api, rol="tecnico", areas=["infraestructura"])
    assert r.status_code == 201, r.text
    b = r.json()
    assert "password_hash" not in b and "password" not in b
    assert b["rol"] == "tecnico" and b["areas"] == ["infraestructura"]
    doc = await api.db.usuarios.find_one({"_id": ObjectId(b["_id"])})
    assert doc["password_hash"].startswith("$argon2")
    # el usuario puede autenticarse con el token emitido
    r = await api.c.get("/auth/me", headers={"Authorization": f"Bearer {crear_access_token(b['_id'])}"})
    assert r.status_code == 200 and r.json()["rol"] == "tecnico"


async def test_crear_usuario_edificio(api):
    r = await _crear(api, rol="jefe_edificio", edificios=["Edificio B"])
    assert r.status_code == 201, r.text
    assert r.json()["edificios"] == ["Edificio B"]


async def test_correo_duplicado_409(api):
    correo = f"dup_{uuid.uuid4().hex[:6]}@e2e.local"
    assert (await _crear(api, correo=correo)).status_code == 201
    assert (await _crear(api, correo=correo)).status_code == 409
    assert (await _crear(api, correo=correo.upper())).status_code == 409


@pytest.mark.parametrize(
    "over",
    [
        {"rol": "inexistente"},
        {"rol": "tecnico"},
        {"rol": "tecnico", "areas": []},
        {"rol": "tecnico", "areas": ["cafeteria"]},
        {"rol": "jefe_edificio"},
        {"rol": "jefe_edificio", "edificios": []},
        {"password": "corta123"},
        {"nombre": "ab"},
        {"correo": "no-es-correo"},
        {"correo": "usuario@externo.edu.mx"},
        {"correo": "usuario@evile2e.local"},
        {"correo": {"$ne": ""}},
        {"rol": {"$ne": ""}},
        {"campo_desconocido": "valor"},
    ],
    ids=[
        "rol_desconocido",
        "area_sin_areas",
        "area_vacia",
        "area_invalida",
        "edificio_sin",
        "edificio_vacio",
        "password_corta",
        "nombre_corto",
        "correo_invalido",
        "correo_externo",
        "correo_parecido",
        "correo_nosql",
        "rol_nosql",
        "campo_extra",
    ],
)
async def test_crear_usuario_invalido_400(api, over):
    antes = await api.db.usuarios.count_documents({})
    r = await _crear(api, **over)
    assert r.status_code == 400, r.text
    assert await api.db.usuarios.count_documents({}) == antes


@pytest.mark.parametrize("quien", ["reportante_a", "tecnico_infra", "coordinador_infra", "directivo", "gestor"])
async def test_usuarios_sin_permiso_403(api, quien):
    assert (await _crear(api, quien=quien)).status_code == 403
    assert (await api.c.get("/usuarios", headers=api.h(quien))).status_code == 403
    r = await api.c.patch(f"/usuarios/{api.oid('reportante_b')}", json={"nombre": "Hackeado"}, headers=api.h(quien))
    assert r.status_code == 403


async def test_listar_usuarios(api):
    r = await api.c.get("/usuarios", headers=api.h("admin"))
    assert r.status_code == 200
    lista = r.json()
    assert len(lista) >= 10
    assert all("password_hash" not in u for u in lista)
    assert "reportante_a@e2e.local" in {u["correo"] for u in lista}


async def test_patch_usuario(api):
    nuevo = (await _crear(api)).json()
    uid = nuevo["_id"]
    url = f"/usuarios/{uid}"
    r = await api.c.patch(url, json={"nombre": "Nombre Cambiado"}, headers=api.h("admin"))
    assert r.status_code == 200, r.text
    assert r.json()["nombre"] == "Nombre Cambiado"

    # cambio de rol a 'area' sin áreas → 400, con áreas válidas → 200
    assert (await api.c.patch(url, json={"rol": "tecnico"}, headers=api.h("admin"))).status_code == 400
    assert (
        await api.c.patch(url, json={"rol": "tecnico", "areas": ["cafeteria"]}, headers=api.h("admin"))
    ).status_code == 400
    assert (await api.c.patch(url, json={"rol": "rol_fantasma"}, headers=api.h("admin"))).status_code == 400
    r = await api.c.patch(url, json={"rol": "tecnico", "areas": ["computo_redes"]}, headers=api.h("admin"))
    assert r.status_code == 200, r.text
    assert r.json()["rol"] == "tecnico" and r.json()["areas"] == ["computo_redes"]
    r = await api.c.patch(url, json={"areas": ["academico", "computo_redes"]}, headers=api.h("admin"))
    assert r.status_code == 200 and sorted(r.json()["areas"]) == ["academico", "computo_redes"]
    assert (await api.c.patch(url, json={"nombre": "ab"}, headers=api.h("admin"))).status_code == 400

    # desactivar: su token existente deja de servir
    token = crear_access_token(uid)
    assert (await api.c.get("/auth/me", headers={"Authorization": f"Bearer {token}"})).status_code == 200
    r = await api.c.patch(url, json={"activo": False}, headers=api.h("admin"))
    assert r.status_code == 200, r.text
    assert (await api.c.get("/auth/me", headers={"Authorization": f"Bearer {token}"})).status_code == 401
    assert (await api.c.get("/incidencias", headers={"Authorization": f"Bearer {token}"})).status_code == 401


async def test_patch_usuario_errores(api):
    r = await api.c.patch(f"/usuarios/{api.oid('admin')}", json={"activo": False}, headers=api.h("admin"))
    assert r.status_code == 400
    assert (await api.c.get("/auth/me", headers=api.h("admin"))).status_code == 200
    assert (
        await api.c.patch(f"/usuarios/{ObjectId()}", json={"nombre": "Alguien"}, headers=api.h("admin"))
    ).status_code == 404
    assert (await api.c.patch("/usuarios/malo", json={"nombre": "Alguien"}, headers=api.h("admin"))).status_code == 400
    r = await api.c.patch(f"/usuarios/{api.oid('reportante_b')}", json={"password_hash": "x"}, headers=api.h("admin"))
    assert r.status_code == 400
    doc = await api.db.usuarios.find_one({"_id": api.oid("reportante_b")})
    assert doc["password_hash"] != "x"
