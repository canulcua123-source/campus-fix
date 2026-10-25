from datetime import datetime, timezone

import pytest

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]

ID_VALIDO = "AbCdEfGhIjKlMnOpQrStUv"


@pytest.fixture
async def aula(api):
    await api.db.aulas.delete_many({})
    await api.db.aulas.insert_one(
        {
            "id_publico": ID_VALIDO,
            "edificio": "Edificio A",
            "piso": 2,
            "aula": "A-201",
            "activa": True,
            "fecha_creacion": datetime.now(timezone.utc),
        }
    )
    return ID_VALIDO


async def test_consulta_aula_autorizada(api, aula):
    respuesta = await api.c.get(f"/aulas/{aula}", headers=api.h("reportante_a"))
    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json() == {
        "id_publico": ID_VALIDO,
        "ubicacion": {"edificio": "Edificio A", "piso": 2, "aula": "A-201"},
    }


async def test_consulta_aula_requiere_autenticacion_y_permiso(api, aula):
    assert (await api.c.get(f"/aulas/{aula}")).status_code == 401
    assert (await api.c.get(f"/aulas/{aula}", headers=api.h("directivo"))).status_code == 403


@pytest.mark.parametrize("aula_id", ["A-201", "ZyXwVuTsRqPoNmLkJiHgFe"])
async def test_consulta_aula_invalida_o_inexistente(api, aula, aula_id):
    respuesta = await api.c.get(f"/aulas/{aula_id}", headers=api.h("reportante_a"))
    assert respuesta.status_code == 404
