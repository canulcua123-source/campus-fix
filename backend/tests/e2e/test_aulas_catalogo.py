from datetime import datetime, timezone

import pytest
import pytest_asyncio

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]

EDIFICIOS = ["Catalogo Prueba Norte", "Catalogo Prueba Sur"]
AULAS = [
    ("CatNorte201xxxxxxxxxxx", EDIFICIOS[0], 2, "N-201", True),
    ("CatNorte101xxxxxxxxxxx", EDIFICIOS[0], 1, "N-101", False),
    ("CatNorte102xxxxxxxxxxx", EDIFICIOS[0], 1, "N-102", True),
    ("CatSur001xxxxxxxxxxxxx", EDIFICIOS[1], 0, "S-001", True),
]


@pytest_asyncio.fixture(loop_scope="session")
async def catalogo(api):
    filtro = {"edificio": {"$in": EDIFICIOS}}
    await api.db.aulas.delete_many(filtro)
    ahora = datetime.now(timezone.utc)
    await api.db.aulas.insert_many(
        [
            {"id_publico": i, "edificio": e, "piso": p, "aula": a, "activa": act, "fecha_creacion": ahora}
            for i, e, p, a, act in AULAS
        ]
    )
    yield
    await api.db.aulas.delete_many(filtro)


async def test_catalogo_agrupado_por_edificio(api, catalogo):
    r = await api.c.get("/aulas", headers=api.h("admin"))
    assert r.status_code == 200, r.text
    por_edificio = {g["edificio"]: g for g in r.json()}
    norte = por_edificio[EDIFICIOS[0]]
    assert norte["total_aulas"] == 3
    assert norte["activas"] == 2
    assert norte["pisos"] == [1, 2]
    assert [a["aula"] for a in norte["aulas"]] == ["N-101", "N-102", "N-201"]
    assert norte["aulas"][0] == {"id_publico": "CatNorte101xxxxxxxxxxx", "piso": 1, "aula": "N-101", "activa": False}
    sur = por_edificio[EDIFICIOS[1]]
    assert (sur["total_aulas"], sur["activas"], sur["pisos"]) == (1, 1, [0])
    nombres = [g["edificio"] for g in r.json()]
    assert nombres == sorted(nombres)
    assert all(None not in a.values() for g in r.json() for a in g["aulas"])


async def test_catalogo_401(api, catalogo):
    assert (await api.c.get("/aulas")).status_code == 401
    assert (await api.c.get("/aulas", headers=api.h("inactivo"))).status_code == 401


@pytest.mark.parametrize("quien", ["reportante_a", "tecnico_infra", "coordinador_infra", "directivo"])
async def test_catalogo_403_sin_permiso(api, catalogo, quien):
    assert (await api.c.get("/aulas", headers=api.h(quien))).status_code == 403


async def test_ruta_detalle_no_choca_con_catalogo(api, catalogo):
    r = await api.c.get(f"/aulas/{AULAS[0][0]}", headers=api.h("reportante_a"))
    assert r.status_code == 200, r.text
    assert r.json()["ubicacion"]["aula"] == "N-201"
