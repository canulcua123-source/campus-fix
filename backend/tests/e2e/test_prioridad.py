import pytest
from bson import ObjectId

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]


async def _prioridad(api, inc_id, prioridad, quien="coordinador_infra"):
    return await api.c.patch(f"/incidencias/{inc_id}/prioridad", json={"prioridad": prioridad}, headers=api.h(quien))


async def test_prioridad_ok_registra_bitacora(api):
    inc = await api.crear()
    r = await _prioridad(api, inc["_id"], "critica")
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "prioridad": "critica"}
    d = await api.doc(inc["_id"])
    assert d["prioridad"] == "critica"
    entrada = d["historial_seguimiento"][-1]
    assert entrada["tipo"] == "prioridad"
    assert entrada["usuario_id"] == api.oid("coordinador_infra")
    assert entrada["estado_nuevo"] == d["estado"]
    assert entrada["comentario"] == "Prioridad: media → critica"
    # El detalle expone la entrada con su tipo y autor.
    r = await api.c.get(f"/incidencias/{inc['_id']}", headers=api.h("coordinador_infra"))
    assert r.status_code == 200, r.text
    assert r.json()["prioridad"] == "critica"
    assert r.json()["historial_seguimiento"][-1]["tipo"] == "prioridad"


async def test_prioridad_igual_no_duplica_bitacora(api):
    inc = await api.crear()
    antes = len((await api.doc(inc["_id"]))["historial_seguimiento"])
    r = await _prioridad(api, inc["_id"], "media")
    assert r.status_code == 200, r.text
    assert len((await api.doc(inc["_id"]))["historial_seguimiento"]) == antes


async def test_prioridad_admin_global(api):
    inc = await api.crear(categoria="computo_redes")
    assert (await _prioridad(api, inc["_id"], "alta", "admin")).status_code == 200
    assert (await api.doc(inc["_id"]))["prioridad"] == "alta"


@pytest.mark.parametrize(
    "cuerpo",
    [{"prioridad": "urgente"}, {"prioridad": None}, {}, {"prioridad": {"$ne": "baja"}}, {"prioridad": "alta", "x": 1}],
    ids=["fuera_enum", "nulo", "vacio", "operador", "extra"],
)
async def test_prioridad_invalida_400(api, cuerpo):
    inc = await api.crear()
    r = await api.c.patch(f"/incidencias/{inc['_id']}/prioridad", json=cuerpo, headers=api.h("coordinador_infra"))
    assert r.status_code == 400, r.text
    assert (await api.doc(inc["_id"]))["prioridad"] == "media"


async def test_prioridad_permisos_alcance_estado(api):
    inc = await api.crear()
    for quien in ("tecnico_infra", "reportante_a", "directivo", "jefe_a"):
        assert (await _prioridad(api, inc["_id"], "alta", quien)).status_code == 403, quien
    redes = await api.crear(categoria="computo_redes")
    assert (await _prioridad(api, redes["_id"], "alta")).status_code == 404
    assert (await _prioridad(api, str(ObjectId()), "alta")).status_code == 404
    assert (await _prioridad(api, "malo", "alta")).status_code == 400
    cerrada = await api.crear_en("cerrada")
    retirada = await api.crear()
    r = await api.c.post(f"/incidencias/{retirada['_id']}/retirar", headers=api.h("reportante_a"))
    assert r.status_code == 200, r.text
    for fin in (cerrada, retirada):
        assert (await _prioridad(api, fin["_id"], "alta")).status_code == 409
        assert (await api.doc(fin["_id"]))["prioridad"] == "media"
    assert (await api.doc(inc["_id"]))["prioridad"] == "media"
    assert (await api.doc(redes["_id"]))["prioridad"] == "media"
