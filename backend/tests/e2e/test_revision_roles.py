import pytest

from .helpers import cuerpo

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]


def _assert_sin_permiso(respuesta, permiso: str) -> None:
    assert respuesta.status_code == 403, respuesta.text
    assert respuesta.json() == {
        "error": "sin_permiso",
        "detalle": f"Falta el permiso {permiso}",
    }


async def test_directivo_no_puede_crear_403(api):
    respuesta = await api.c.post(
        "/incidencias",
        json=cuerpo("infraestructura"),
        headers=api.h("directivo"),
    )

    _assert_sin_permiso(respuesta, "incidencias:crear")


async def test_reportante_no_ve_analitica_403(api):
    for ruta in ("/analitica/edificios", "/analitica/tags", "/analitica/resumen"):
        respuesta = await api.c.get(ruta, headers=api.h("reportante_a"))
        _assert_sin_permiso(respuesta, "analitica:ver")
