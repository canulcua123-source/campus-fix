import pytest
from bson import ObjectId

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]


async def _tags(api, metodo, inc_id, tags, quien="tecnico_infra"):
    return await api.c.request(metodo, f"/incidencias/{inc_id}/tags", json={"tags": tags}, headers=api.h(quien))


async def test_tags_agregar_quitar(api):
    inc = await api.crear(tags=["prueba"])
    r = await _tags(api, "POST", inc["_id"], ["Aire Acondicionado", "aire_acondicionado", "Climatización", "prueba"])
    assert r.status_code == 200, r.text
    tags = (await api.doc(inc["_id"]))["tags"]
    assert sorted(tags) == ["aire_acondicionado", "climatizacion", "prueba"]

    r = await _tags(api, "DELETE", inc["_id"], ["Aire Acondicionado"])
    assert r.status_code == 200, r.text
    assert sorted((await api.doc(inc["_id"]))["tags"]) == ["climatizacion", "prueba"]

    r = await _tags(api, "DELETE", inc["_id"], ["Climatización"])
    assert r.status_code == 200
    assert (await api.doc(inc["_id"]))["tags"] == ["prueba"]


@pytest.mark.parametrize("tags", [["a"], ["con-guion"], ["$where"], [], [f"t{i:02d}" for i in range(16)], [{"$ne": 1}]],
                         ids=["corto", "guion", "operador", "vacio", "16", "objeto"])
async def test_tags_invalidos(api, tags):
    inc = await api.crear()
    antes = (await api.doc(inc["_id"]))["tags"]
    for metodo in ("POST", "DELETE"):
        r = await _tags(api, metodo, inc["_id"], tags)
        assert r.status_code == 400, f"{metodo}: {r.status_code} {r.text}"
    assert (await api.doc(inc["_id"]))["tags"] == antes


async def test_tags_total_maximo_15(api):
    inc = await api.crear(tags=[f"base{i:02d}" for i in range(10)])
    r = await _tags(api, "POST", inc["_id"], [f"nuevo{i:02d}" for i in range(6)])
    assert r.status_code in (400, 409), r.text
    assert len((await api.doc(inc["_id"]))["tags"]) <= 15


async def test_tags_permisos_y_alcance(api):
    inc = await api.crear(edificio="Edificio B")
    assert (await _tags(api, "POST", inc["_id"], ["x1"], "reportante_a")).status_code == 403
    assert (await _tags(api, "POST", inc["_id"], ["x1"], "directivo")).status_code == 403
    assert (await _tags(api, "POST", inc["_id"], ["x1"], "tecnico_redes")).status_code == 404
    assert (await _tags(api, "DELETE", inc["_id"], ["prueba"], "tecnico_redes")).status_code == 404
    assert (await _tags(api, "POST", inc["_id"], ["x1"], "jefe_a")).status_code == 404
    assert (await _tags(api, "POST", str(ObjectId()), ["x1"], "admin")).status_code == 404
    assert (await _tags(api, "POST", "malo", ["x1"], "admin")).status_code == 400
    assert (await api.doc(inc["_id"]))["tags"] == ["prueba"]
    inc_a = await api.crear(edificio="Edificio A")
    assert (await _tags(api, "POST", inc_a["_id"], ["jefe_ok"], "jefe_a")).status_code == 200


# ---------- asignación ----------

async def _asignar(api, inc_id, tecnico_id, quien="coordinador_infra"):
    return await api.c.patch(f"/incidencias/{inc_id}/asignacion", json={"tecnico_id": str(tecnico_id)}, headers=api.h(quien))


async def test_asignar_ok(api):
    inc = await api.crear()
    r = await _asignar(api, inc["_id"], api.oid("tecnico_infra"))
    assert r.status_code == 200, r.text
    d = await api.doc(inc["_id"])
    assert d["tecnico_asignado"]["usuario_id"] == api.oid("tecnico_infra")
    assert d["tecnico_asignado"]["nombre"] == api.u["tecnico_infra"]["nombre"]
    # reasignación por admin
    r = await _asignar(api, inc["_id"], api.oid("tecnico_infra2"), quien="admin")
    assert r.status_code == 200
    assert (await api.doc(inc["_id"]))["tecnico_asignado"]["usuario_id"] == api.oid("tecnico_infra2")
    r = await api.c.get(f"/incidencias/{inc['_id']}", headers=api.h("admin"))
    assert r.json()["tecnico_asignado"]["usuario_id"] == str(api.oid("tecnico_infra2"))


async def test_asignar_tecnico_invalido_400(api):
    inc = await api.crear()
    casos = {
        "otra_area": api.oid("tecnico_redes"),
        "sin_seguimiento": api.oid("reportante_a"),
        "directivo": api.oid("directivo"),
        "inactivo": api.oid("tecnico_inactivo"),
        "inexistente": ObjectId(),
        "no_oid": "zzzzzzzzzzzzzzzzzzzzzzzz",
    }
    for nombre, tid in casos.items():
        r = await _asignar(api, inc["_id"], tid)
        assert r.status_code == 400, f"{nombre}: {r.status_code} {r.text}"
    r = await api.c.patch(f"/incidencias/{inc['_id']}/asignacion", json={"tecnico_id": {"$ne": None}},
                          headers=api.h("coordinador_infra"))
    assert r.status_code == 400
    assert "tecnico_asignado" not in await api.doc(inc["_id"])


async def test_asignar_permisos_alcance_estado(api):
    infra = await api.crear()
    assert (await _asignar(api, infra["_id"], api.oid("tecnico_infra"), "tecnico_infra")).status_code == 403
    assert (await _asignar(api, infra["_id"], api.oid("tecnico_infra"), "reportante_a")).status_code == 403
    assert (await _asignar(api, infra["_id"], api.oid("tecnico_infra"), "directivo")).status_code == 403
    redes = await api.crear(categoria="computo_redes")
    assert (await _asignar(api, redes["_id"], api.oid("tecnico_redes"))).status_code == 404
    assert (await _asignar(api, str(ObjectId()), api.oid("tecnico_infra"))).status_code == 404
    assert (await _asignar(api, "malo", api.oid("tecnico_infra"))).status_code == 400
    cerrada = await api.crear_en("cerrada")
    assert (await _asignar(api, cerrada["_id"], api.oid("tecnico_infra"))).status_code == 409
    assert "tecnico_asignado" not in await api.doc(cerrada["_id"])
