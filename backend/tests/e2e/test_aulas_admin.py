"""Alta y edición manual de aulas desde Admin → Edificios (RF-ADM-04, issue #138)."""

import pytest
import pytest_asyncio

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]

EDIFICIO = "Alta Manual E2E"
OTRO = "Alta Manual E2E Bis"


@pytest_asyncio.fixture(loop_scope="session")
async def limpio(api):
    filtro = {"edificio": {"$in": [EDIFICIO, OTRO]}}
    await api.db.aulas.delete_many(filtro)
    yield
    await api.db.aulas.delete_many(filtro)


async def _crear(api, **datos) -> dict:
    cuerpo = {"edificio": EDIFICIO, "piso": 1, "aula": "M-101", **datos}
    r = await api.c.post("/aulas", json=cuerpo, headers=api.h("admin"))
    assert r.status_code == 201, r.text
    return r.json()


async def _ubicaciones(api) -> list[dict]:
    r = await api.c.get("/aulas/ubicaciones", headers=api.h("reportante_a"))
    assert r.status_code == 200, r.text
    return [u for u in r.json() if u["edificio"] in (EDIFICIO, OTRO)]


async def test_crear_aula_aparece_en_catalogo_y_ubicaciones(api, limpio):
    aula = await _crear(api, edificio=f"  {EDIFICIO} ", aula=" M-101 ")
    assert set(aula) == {"id_publico", "edificio", "piso", "aula", "activa"}
    assert (aula["edificio"], aula["piso"], aula["aula"], aula["activa"]) == (EDIFICIO, 1, "M-101", True)
    assert len(aula["id_publico"]) == 22

    doc = await api.db.aulas.find_one({"id_publico": aula["id_publico"]})
    assert doc is not None and "fecha_creacion" in doc

    catalogo = (await api.c.get("/aulas", headers=api.h("admin"))).json()
    grupo = next(g for g in catalogo if g["edificio"] == EDIFICIO)
    assert grupo["aulas"] == [{"id_publico": aula["id_publico"], "piso": 1, "aula": "M-101", "activa": True}]
    assert await _ubicaciones(api) == [{"edificio": EDIFICIO, "piso": 1, "aula": "M-101"}]

    qr = await api.c.get(f"/aulas/{aula['id_publico']}", headers=api.h("reportante_a"))
    assert qr.status_code == 200, qr.text


async def test_crear_aula_inactiva_no_aparece_en_ubicaciones(api, limpio):
    aula = await _crear(api, aula="M-102", activa=False)
    assert aula["activa"] is False
    assert await _ubicaciones(api) == []


async def test_crear_aula_duplicada_409(api, limpio):
    await _crear(api)
    r = await api.c.post("/aulas", json={"edificio": EDIFICIO, "piso": 1, "aula": "M-101"}, headers=api.h("admin"))
    assert r.status_code == 409, r.text
    assert r.json()["detalle"] == "Ya existe un aula con ese edificio, piso y aula"


@pytest.mark.parametrize(
    "cuerpo",
    [
        {"edificio": "", "piso": 1, "aula": "X"},
        {"edificio": "   ", "piso": 1, "aula": "X"},
        {"edificio": "A", "piso": 51, "aula": "X"},
        {"edificio": "A", "piso": -6, "aula": "X"},
        {"edificio": "A", "piso": "2", "aula": "X"},
        {"edificio": "A" * 61, "piso": 1, "aula": "X"},
        {"edificio": "A", "piso": 1},
        {"edificio": "A", "piso": 1, "aula": "X", "id_publico": "AbCdEfGhIjKlMnOpQrStUv"},
    ],
)
async def test_crear_aula_400(api, limpio, cuerpo):
    r = await api.c.post("/aulas", json=cuerpo, headers=api.h("admin"))
    assert r.status_code == 400, r.text


async def test_crear_aula_401(api):
    assert (await api.c.post("/aulas", json={"edificio": EDIFICIO, "piso": 1, "aula": "Z"})).status_code == 401


@pytest.mark.parametrize("quien", ["reportante_a", "tecnico_infra", "coordinador_infra", "directivo"])
async def test_crear_y_editar_aula_403(api, limpio, quien):
    cuerpo = {"edificio": EDIFICIO, "piso": 1, "aula": "Z"}
    assert (await api.c.post("/aulas", json=cuerpo, headers=api.h(quien))).status_code == 403
    aula = await _crear(api, aula="M-403")
    r = await api.c.patch(f"/aulas/{aula['id_publico']}", json={"activa": False}, headers=api.h(quien))
    assert r.status_code == 403
    assert (await api.db.aulas.find_one({"id_publico": aula["id_publico"]}))["activa"] is True


async def test_editar_aula_y_desactivar(api, limpio):
    aula = await _crear(api)
    r = await api.c.patch(
        f"/aulas/{aula['id_publico']}", json={"edificio": OTRO, "piso": 3, "aula": "B-301"}, headers=api.h("admin")
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"id_publico": aula["id_publico"], "edificio": OTRO, "piso": 3, "aula": "B-301", "activa": True}
    assert await _ubicaciones(api) == [{"edificio": OTRO, "piso": 3, "aula": "B-301"}]

    r = await api.c.patch(f"/aulas/{aula['id_publico']}", json={"activa": False}, headers=api.h("admin"))
    assert r.status_code == 200, r.text
    assert r.json()["activa"] is False
    assert await _ubicaciones(api) == []
    assert (await api.c.get(f"/aulas/{aula['id_publico']}", headers=api.h("reportante_a"))).status_code == 404


async def test_editar_aula_duplicada_409(api, limpio):
    await _crear(api)
    otra = await _crear(api, aula="M-102")
    r = await api.c.patch(f"/aulas/{otra['id_publico']}", json={"aula": "M-101"}, headers=api.h("admin"))
    assert r.status_code == 409, r.text
    assert (await api.db.aulas.find_one({"id_publico": otra["id_publico"]}))["aula"] == "M-102"


@pytest.mark.parametrize("cuerpo", [{}, {"activa": None}, {"piso": 99}, {"aula": ""}, {"extra": 1}])
async def test_editar_aula_400(api, limpio, cuerpo):
    aula = await _crear(api)
    r = await api.c.patch(f"/aulas/{aula['id_publico']}", json=cuerpo, headers=api.h("admin"))
    assert r.status_code == 400, r.text


@pytest.mark.parametrize("aula_id", ["NoExisteNoExisteNoExis", "corto", "con$caracteres!invalidos"])
async def test_editar_aula_404(api, aula_id):
    r = await api.c.patch(f"/aulas/{aula_id}", json={"activa": False}, headers=api.h("admin"))
    assert r.status_code == 404, r.text
    assert r.json()["detalle"] == "Aula no encontrada"


async def test_editar_aula_401(api):
    assert (await api.c.patch("/aulas/NoExisteNoExisteNoExis", json={"activa": False})).status_code == 401


async def test_auditoria_registra_alta_y_edicion_de_aula(api, limpio):
    aula = await _crear(api, aula="M-AUD")
    r = await api.c.patch(f"/aulas/{aula['id_publico']}", json={"activa": False}, headers=api.h("admin"))
    assert r.status_code == 200, r.text

    eventos = [
        e async for e in api.db.auditoria.find({"recurso": "aulas", "recurso_id": aula["id_publico"]}).sort("fecha", 1)
    ]
    assert [e["accion"] for e in eventos] == ["crear", "editar"]
    assert eventos[0]["actor_id"] == api.oid("admin")
    assert eventos[0]["despues"] == {"edificio": EDIFICIO, "aula": "M-AUD", "piso": 1, "activa": True}
    assert "antes" not in eventos[0]
    assert eventos[1]["antes"]["activa"] is True and eventos[1]["despues"]["activa"] is False

    r = await api.c.get("/auditoria", params={"recurso": "aulas", "limite": 100}, headers=api.h("admin"))
    assert r.status_code == 200, r.text
    propios = [e for e in r.json()["resultados"] if e["recurso_id"] == aula["id_publico"]]
    assert {e["accion"] for e in propios} == {"crear", "editar"}
    assert all(e["despues"]["aula"] == "M-AUD" for e in propios)
