import asyncio
from datetime import datetime

import pytest
from bson import ObjectId

from .helpers import RUTAS

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]

ESTADOS = ["abierta", "en_proceso", "en_espera", "resuelta", "cerrada"]
VALIDAS = {
    "abierta": {"en_proceso", "en_espera"},
    "en_proceso": {"en_espera", "resuelta"},
    "en_espera": {"en_proceso"},
    "resuelta": {"cerrada", "en_proceso"},
    "cerrada": set(),
}
MATRIZ = [(o, d) for o in ESTADOS for d in ESTADOS if o != d]


@pytest.mark.parametrize("origen,destino", MATRIZ, ids=[f"{o}->{d}" for o, d in MATRIZ])
async def test_matriz_transiciones(api, origen, destino):
    inc = await api.crear_en(origen, "reportante_a", "infraestructura")
    antes = await api.doc(inc["_id"])
    r = await api.seguimiento(inc["_id"], destino, quien="coordinador_infra")
    despues = await api.doc(inc["_id"])
    if destino in VALIDAS[origen]:
        assert r.status_code == 200, r.text
        assert despues["estado"] == destino
        assert len(despues["historial_seguimiento"]) == len(antes["historial_seguimiento"]) + 1
    else:
        assert r.status_code == 409, r.text
        assert despues["estado"] == origen
        assert despues["historial_seguimiento"] == antes["historial_seguimiento"]


async def test_mismo_estado_409(api):
    inc = await api.crear_en("en_proceso")
    r = await api.seguimiento(inc["_id"], "en_proceso", quien="tecnico_infra")
    assert r.status_code == 409


async def test_resolucion_horas_reapertura(api):
    inc = await api.crear("reportante_a", "infraestructura")
    i = inc["_id"]
    assert (await api.seguimiento(i, "en_proceso", quien="tecnico_infra", horas=2)).status_code == 200
    assert (await api.seguimiento(i, "resuelta", quien="tecnico_infra", horas=3.5)).status_code == 200
    d = await api.doc(i)
    assert isinstance(d["fecha_resolucion"], datetime)
    assert d["horas_invertidas"] == pytest.approx(5.5)
    assert len(d["historial_seguimiento"]) == 3
    ult = d["historial_seguimiento"][-1]
    assert ult["estado_nuevo"] == "resuelta" and ult["usuario_id"] == api.oid("tecnico_infra")

    # reapertura
    assert (await api.seguimiento(i, "en_proceso", quien="tecnico_infra", horas=1)).status_code == 200
    d = await api.doc(i)
    assert "fecha_resolucion" not in d
    assert d["horas_invertidas"] == pytest.approx(6.5)
    assert len(d["historial_seguimiento"]) == 4


async def test_cerrar_requiere_asignar(api):
    inc = await api.crear_en("resuelta")
    r = await api.seguimiento(inc["_id"], "cerrada", quien="tecnico_infra")
    assert r.status_code == 403, r.text
    assert (await api.doc(inc["_id"]))["estado"] == "resuelta"
    r = await api.seguimiento(inc["_id"], "cerrada", quien="coordinador_infra")
    assert r.status_code == 200, r.text
    assert (await api.doc(inc["_id"]))["estado"] == "cerrada"


@pytest.mark.parametrize("body", [
    {"estado_nuevo": "en_proceso", "comentario": "abc", "horas": 1},
    {"estado_nuevo": "en_proceso", "comentario": "x" * 1001, "horas": 1},
    {"estado_nuevo": "en_proceso", "comentario": "Comentario ok", "horas": -1},
    {"estado_nuevo": "en_proceso", "comentario": "Comentario ok", "horas": 25},
    {"estado_nuevo": "inventado", "comentario": "Comentario ok", "horas": 1},
    {"estado_nuevo": {"$ne": "x"}, "comentario": "Comentario ok", "horas": 1},
    {"estado_nuevo": "en_proceso", "comentario": "Comentario ok"},
    {"estado_nuevo": "en_proceso", "comentario": "Comentario ok", "horas": 1, "extra": 1},
], ids=["comentario_corto", "comentario_largo", "horas_neg", "horas_25", "estado_invalido", "nosql", "sin_horas", "extra"])
async def test_seguimiento_validacion(api, body):
    inc = await api.crear()
    r = await api.c.patch(f"/incidencias/{inc['_id']}/seguimiento", json=body, headers=api.h("tecnico_infra"))
    assert r.status_code == 400, r.text
    assert (await api.doc(inc["_id"]))["estado"] == "abierta"


async def test_seguimiento_permisos_y_alcance(api):
    inc = await api.crear("reportante_a", "infraestructura", edificio="Edificio B")
    antes = await api.doc(inc["_id"])
    for quien, esperado in (("reportante_a", {403}), ("directivo", {403}),
                            ("tecnico_redes", {404, 409}), ("jefe_a", {404, 409})):
        r = await api.seguimiento(inc["_id"], "en_proceso", quien=quien)
        assert r.status_code in esperado, f"{quien}: {r.status_code}"
    assert await api.doc(inc["_id"]) == antes
    r = await api.seguimiento(str(ObjectId()), "en_proceso", quien="admin")
    assert r.status_code in (404, 409)
    r = await api.seguimiento("no-oid", "en_proceso", quien="admin")
    assert r.status_code == 400
    # jefe_a sí puede en su edificio
    inc_a = await api.crear("reportante_a", "academico", edificio="Edificio A")
    assert (await api.seguimiento(inc_a["_id"], "en_proceso", quien="jefe_a")).status_code == 200


async def test_seguimiento_fuera_de_alcance_es_404(api):
    """Aclaración del contrato: fuera de alcance/inexistente → 404 (409 solo para transición inválida)."""
    inc = await api.crear("reportante_a", "infraestructura")
    r = await api.seguimiento(inc["_id"], "en_proceso", quien="tecnico_redes")
    assert r.status_code == 404
    r = await api.seguimiento(str(ObjectId()), "en_proceso", quien="admin")
    assert r.status_code == 404


async def test_concurrencia_transicion(api):
    inc = await api.crear()
    antes = len((await api.doc(inc["_id"]))["historial_seguimiento"])
    r1, r2 = await asyncio.gather(
        api.seguimiento(inc["_id"], "en_proceso", quien="tecnico_infra"),
        api.seguimiento(inc["_id"], "en_proceso", quien="tecnico_infra2"),
    )
    assert sorted([r1.status_code, r2.status_code]) == [200, 409]
    d = await api.doc(inc["_id"])
    assert len(d["historial_seguimiento"]) == antes + 1
    assert d["horas_invertidas"] == 1


assert set(RUTAS) == set(ESTADOS)
