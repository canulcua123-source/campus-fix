import pytest

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]


def _rol(**over):
    b = {
        "clave": "auditor_pruebas",
        "nombre": "Auditor",
        "descripcion": "rol e2e",
        "permisos": ["incidencias:ver", "analitica:ver"],
        "alcance": "global",
    }
    b.update(over)
    return b


async def test_crear_rol_y_duplicado(api):
    r = await api.c.post("/roles", json=_rol(), headers=api.h("admin"))
    assert r.status_code == 201, r.text
    assert r.json()["clave"] == "auditor_pruebas"
    assert await api.db.roles.find_one({"clave": "auditor_pruebas"})
    r = await api.c.post("/roles", json=_rol(nombre="Otro"), headers=api.h("admin"))
    assert r.status_code == 409


@pytest.mark.parametrize(
    "over",
    [
        {"clave": "Mal-Clave"},
        {"clave": "ab"},
        {"clave": {"$ne": ""}},
        {"permisos": ["incidencias:volar"]},
        {"permisos": ["incidencias:ver", "incidencias:ver"]},
        {"permisos": []},
        {"alcance": "universo"},
        {"nombre": "ab"},
    ],
    ids=[
        "clave_patron",
        "clave_corta",
        "clave_nosql",
        "permiso_desconocido",
        "permiso_dup",
        "sin_permisos",
        "alcance",
        "nombre",
    ],
)
async def test_crear_rol_invalido(api, over):
    body = {**_rol(clave="rol_invalido"), **over}
    r = await api.c.post("/roles", json=body, headers=api.h("admin"))
    assert r.status_code == 400, r.text


@pytest.mark.parametrize("quien", ["reportante_a", "tecnico_infra", "coordinador_infra", "directivo", "jefe_a"])
async def test_roles_no_admin_403(api, quien):
    rol_base = await api.db.roles.find_one({"clave": "reportante"})
    assert (await api.c.post("/roles", json=_rol(clave="intruso"), headers=api.h(quien))).status_code == 403
    assert (await api.c.get("/roles", headers=api.h(quien))).status_code == 403
    assert (
        await api.c.patch(f"/roles/{rol_base['_id']}", json={"nombre": "Intruso"}, headers=api.h(quien))
    ).status_code == 403
    assert (await api.c.delete(f"/roles/{rol_base['_id']}", headers=api.h(quien))).status_code == 403


async def test_listar_roles_admin(api):
    r = await api.c.get("/roles", headers=api.h("admin"))
    assert r.status_code == 200
    claves = {x["clave"] for x in r.json()}
    assert {"reportante", "tecnico", "coordinador", "directivo", "admin", "jefe_edificio"} <= claves


async def test_escalada_privilegios(api):
    r = await api.c.post(
        "/roles", json=_rol(clave="escalada", permisos=["incidencias:ver", "analitica:ver"]), headers=api.h("gestor")
    )
    assert r.status_code == 403, r.text
    r = await api.c.post(
        "/roles",
        json=_rol(clave="escalada", permisos=["roles:gestionar", "usuarios:gestionar"]),
        headers=api.h("gestor"),
    )
    assert r.status_code == 403
    assert await api.db.roles.find_one({"clave": "escalada"}) is None
    # dentro de sus permisos sí puede
    r = await api.c.post("/roles", json=_rol(clave="solo_ver", permisos=["incidencias:ver"]), headers=api.h("gestor"))
    assert r.status_code == 201, r.text


async def test_admin_no_puede_editar_rol_base(api):
    antes = await api.db.roles.find_one({"clave": "directivo"})
    r = await api.c.patch(
        f"/roles/{antes['_id']}",
        json={"clave": "directivo_modificado", "permisos": ["incidencias:crear"]},
        headers=api.h("admin"),
    )
    assert r.status_code == 409, r.text
    despues = await api.db.roles.find_one({"_id": antes["_id"]})
    assert despues == antes


async def test_admin_no_puede_eliminar_rol_base(api):
    antes = await api.db.roles.find_one({"clave": "reportante"})
    r = await api.c.delete(f"/roles/{antes['_id']}", headers=api.h("admin"))
    assert r.status_code == 409, r.text
    assert await api.db.roles.find_one({"_id": antes["_id"]}) == antes


async def test_rol_personalizado_se_puede_editar_y_eliminar(api):
    creado = await api.c.post(
        "/roles", json=_rol(clave="temporal_editable", permisos=["incidencias:ver"]), headers=api.h("admin")
    )
    assert creado.status_code == 201, creado.text
    rol_id = creado.json()["_id"]

    editado = await api.c.patch(
        f"/roles/{rol_id}",
        json={"clave": "temporal_editado", "nombre": "Temporal editado", "permisos": ["incidencias:buscar"]},
        headers=api.h("admin"),
    )
    assert editado.status_code == 200, editado.text
    assert editado.json()["clave"] == "temporal_editado"
    assert editado.json()["permisos"] == ["incidencias:buscar"]

    eliminado = await api.c.delete(f"/roles/{rol_id}", headers=api.h("admin"))
    assert eliminado.status_code == 200, eliminado.text
    assert eliminado.json() == {"ok": True}
    assert await api.db.roles.find_one({"clave": "temporal_editado"}) is None


async def test_rol_personalizado_asignado_no_pierde_su_referencia(api):
    antes = await api.db.roles.find_one({"clave": "gestor_roles"})
    r = await api.c.patch(f"/roles/{antes['_id']}", json={"clave": "gestor_renombrado"}, headers=api.h("admin"))
    assert r.status_code == 409, r.text
    assert await api.db.roles.find_one({"_id": antes["_id"]}) == antes

    r = await api.c.delete(f"/roles/{antes['_id']}", headers=api.h("admin"))
    assert r.status_code == 409, r.text
    assert await api.db.roles.find_one({"_id": antes["_id"]}) == antes


async def test_categorias(api):
    assert (await api.c.get("/categorias")).status_code == 401
    for quien in ("reportante_a", "tecnico_infra", "directivo", "jefe_a", "admin"):
        r = await api.c.get("/categorias", headers=api.h(quien))
        assert r.status_code == 200, quien
        assert {c["clave"] for c in r.json()} == {"computo_redes", "infraestructura", "academico"}
