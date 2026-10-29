"""Un técnico ve lo que él reportó fuera de su área, pero no puede operarlo como técnico."""

import uuid

import pytest

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]


async def test_tecnico_ve_su_reporte_fuera_de_area(api):
    marca = f"visprop{uuid.uuid4().hex[:8]}"
    propio = await api.crear("tecnico_infra", "computo_redes", titulo=f"{marca} propio fuera de area", tags=[marca])
    ajeno = await api.crear("reportante_b", "computo_redes", titulo=f"{marca} ajeno fuera de area", tags=[marca])
    h = api.h("tecnico_infra")

    r = await api.c.get("/incidencias", params={"limite": 100}, headers=h)
    assert r.status_code == 200
    ids = {i["_id"] for i in r.json()}
    assert propio["_id"] in ids
    assert ajeno["_id"] not in ids

    r = await api.c.get("/incidencias", params={"propias": True, "limite": 100}, headers=h)
    assert propio["_id"] in {i["_id"] for i in r.json()}

    assert (await api.c.get(f"/incidencias/{propio['_id']}", headers=h)).status_code == 200
    assert (await api.c.get(f"/incidencias/{ajeno['_id']}", headers=h)).status_code == 404

    r = await api.c.get("/incidencias/buscar", params={"q": propio["codigo"]}, headers=h)
    assert r.status_code == 200
    assert propio["_id"] in {i["_id"] for i in r.json()}

    # Fuera de su área no puede actuar como técnico sobre su propio reporte.
    r = await api.c.post(f"/incidencias/{propio['_id']}/tomar", headers=h)
    assert r.status_code == 404
    assert "tecnico_asignado" not in await api.doc(propio["_id"])

    # Otro técnico de la misma área no ve el reporte del primero.
    r = await api.c.get(f"/incidencias/{propio['_id']}", headers=api.h("tecnico_infra2"))
    assert r.status_code == 404

    await api.db.incidencias_campus.delete_many({"tags": marca})
