import pytest
from bson import ObjectId

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]


async def _tecnicos(api, quien="coordinador_infra", **params):
    return await api.c.get("/usuarios/tecnicos", params=params, headers=api.h(quien) if quien else {})


async def test_tecnicos_del_area_del_coordinador(api):
    r = await _tecnicos(api)
    assert r.status_code == 200, r.text
    ids = {t["_id"] for t in r.json()}
    assert {str(api.oid("tecnico_infra")), str(api.oid("tecnico_infra2"))} <= ids
    # Fuera de su área, inactivos y no técnicos (coordinador, admin, reportante) no aparecen.
    for quien in ("tecnico_redes", "tecnico_inactivo", "coordinador_infra", "admin", "reportante_a", "jefe_a"):
        assert str(api.oid(quien)) not in ids, quien
    assert all(set(t) <= {"_id", "nombre", "areas", "edificios"} for t in r.json())


async def test_tecnicos_filtrados_por_area(api):
    assert (await _tecnicos(api, area="computo_redes")).json() == []
    r = await _tecnicos(api, "admin", area="computo_redes")
    ids = {t["_id"] for t in r.json()}
    assert str(api.oid("tecnico_redes")) in ids
    assert str(api.oid("tecnico_infra")) not in ids


async def test_tecnicos_admin_global(api):
    ids = {t["_id"] for t in (await _tecnicos(api, "admin")).json()}
    assert {str(api.oid(q)) for q in ("tecnico_infra", "tecnico_redes", "jefe_a")} <= ids
    assert str(api.oid("tecnico_inactivo")) not in ids


@pytest.mark.parametrize("area", ["Infraestructura", "otra", '{"$ne": null}'])
async def test_tecnicos_400(api, area):
    assert (await _tecnicos(api, area=area)).status_code == 400


async def test_tecnicos_401(api):
    assert (await _tecnicos(api, None)).status_code == 401
    assert (await _tecnicos(api, "inactivo")).status_code == 401


@pytest.mark.parametrize("quien", ["reportante_a", "tecnico_infra", "directivo", "jefe_a"])
async def test_tecnicos_403(api, quien):
    assert (await _tecnicos(api, quien)).status_code == 403


# ---------- filtro por técnico en GET /incidencias ----------


async def test_listado_filtra_por_tecnico(api):
    asignada = await api.crear()
    libre = await api.crear()
    r = await api.c.patch(
        f"/incidencias/{asignada['_id']}/asignacion",
        json={"tecnico_id": str(api.oid("tecnico_infra2"))},
        headers=api.h("coordinador_infra"),
    )
    assert r.status_code == 200, r.text
    h = api.h("coordinador_infra")
    lista = (await api.c.get("/incidencias", params={"tecnico": str(api.oid("tecnico_infra2"))}, headers=h)).json()
    assert asignada["_id"] in {d["_id"] for d in lista}
    assert all(d["tecnico_asignado"]["usuario_id"] == str(api.oid("tecnico_infra2")) for d in lista)
    sin = (await api.c.get("/incidencias", params={"tecnico": "sin_asignar"}, headers=h)).json()
    assert libre["_id"] in {d["_id"] for d in sin}
    assert all("tecnico_asignado" not in d for d in sin)
    # Se suma al alcance: el reportante no ve incidencias ajenas aunque filtre por técnico.
    ajena = await api.c.get(
        "/incidencias", params={"tecnico": str(api.oid("tecnico_infra2"))}, headers=api.h("reportante_b")
    )
    assert asignada["_id"] not in {d["_id"] for d in ajena.json()}


@pytest.mark.parametrize("tecnico", ["malo", str(ObjectId()).upper(), '{"$ne": null}'])
async def test_listado_filtro_tecnico_invalido(api, tecnico):
    r = await api.c.get("/incidencias", params={"tecnico": tecnico}, headers=api.h("admin"))
    assert r.status_code == 400, r.text
