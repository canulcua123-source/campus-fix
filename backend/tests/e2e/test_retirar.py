import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from bson import ObjectId

import app.routers.incidencias as router_incidencias


pytestmark = pytest.mark.e2e
AHORA = datetime(2026, 10, 25, 18, 0, tzinfo=timezone.utc)


async def _crear_con_antiguedad(api, antiguedad: timedelta, *, quien: str = "reportante_a") -> dict:
    incidencia = await api.crear(quien)
    await api.db.incidencias_campus.update_one(
        {"_id": ObjectId(incidencia["_id"])},
        {
            "$set": {
                "fecha_creacion": AHORA - antiguedad,
                "fecha_actualizacion": AHORA - antiguedad,
            }
        },
    )
    return incidencia


async def _retirar(api, incidencia_id: str, quien: str = "reportante_a"):
    return await api.c.post(
        f"/incidencias/{incidencia_id}/retirar",
        headers=api.h(quien),
    )


@pytest.fixture(autouse=True)
def _reloj_fijo(monkeypatch):
    monkeypatch.setattr(router_incidencias, "ahora_utc", lambda: AHORA)


@pytest.mark.asyncio
async def test_retirar_ok(api):
    incidencia = await _crear_con_antiguedad(api, timedelta(minutes=14))
    anterior = {
        "fecha": AHORA - timedelta(minutes=10),
        "usuario_id": api.oid("reportante_a"),
        "estado_nuevo": "abierta",
        "comentario": "Historial previo conservado",
        "horas": 0,
    }
    await api.db.incidencias_campus.update_one(
        {"_id": ObjectId(incidencia["_id"])},
        {"$push": {"historial_seguimiento": anterior}},
    )

    respuesta = await _retirar(api, incidencia["_id"])

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json() == {"ok": True, "estado": "retirada"}
    documento = await api.doc(incidencia["_id"])
    assert documento["estado"] == "retirada"
    assert documento["fecha_actualizacion"] == AHORA
    assert [e["comentario"] for e in documento["historial_seguimiento"]][-2:] == [
        "Historial previo conservado",
        "Reporte retirado por su reportante",
    ]
    assert documento["historial_seguimiento"][-1]["usuario_id"] == api.oid("reportante_a")
    assert await api.db.incidencias_campus.count_documents({"_id": ObjectId(incidencia["_id"])}) == 1


@pytest.mark.asyncio
async def test_retirar_limite_exacto_15_minutos(api):
    incidencia = await _crear_con_antiguedad(api, timedelta(minutes=15))
    respuesta = await _retirar(api, incidencia["_id"])
    assert respuesta.status_code == 200, respuesta.text


@pytest.mark.asyncio
async def test_retirar_fuera_ventana_409(api):
    incidencia = await _crear_con_antiguedad(api, timedelta(minutes=15, microseconds=1))
    respuesta = await _retirar(api, incidencia["_id"])
    assert respuesta.status_code == 409
    assert respuesta.json()["error"] == "conflicto"
    assert (await api.doc(incidencia["_id"]))["estado"] == "abierta"


@pytest.mark.asyncio
async def test_retirar_asignada_409(api):
    incidencia = await _crear_con_antiguedad(api, timedelta(minutes=5))
    asignacion = await api.c.patch(
        f"/incidencias/{incidencia['_id']}/asignacion",
        json={"tecnico_id": str(api.oid("tecnico_infra"))},
        headers=api.h("coordinador_infra"),
    )
    assert asignacion.status_code == 200, asignacion.text

    respuesta = await _retirar(api, incidencia["_id"])
    assert respuesta.status_code == 409
    assert (await api.doc(incidencia["_id"]))["estado"] == "abierta"


@pytest.mark.asyncio
async def test_retirar_otro_usuario(api):
    incidencia = await _crear_con_antiguedad(api, timedelta(minutes=5))
    respuesta = await _retirar(api, incidencia["_id"], "reportante_b")
    assert respuesta.status_code == 404
    assert respuesta.json()["error"] == "no_encontrado"


@pytest.mark.asyncio
@pytest.mark.parametrize("estado", ["en_proceso", "en_espera", "resuelta", "cerrada"])
async def test_retirar_rechaza_estados_distintos_de_abierta(api, estado):
    incidencia = await api.crear_en(estado)
    await api.db.incidencias_campus.update_one(
        {"_id": ObjectId(incidencia["_id"])},
        {"$set": {"fecha_creacion": AHORA - timedelta(minutes=5)}},
    )
    respuesta = await _retirar(api, incidencia["_id"])
    assert respuesta.status_code == 409
    assert (await api.doc(incidencia["_id"]))["estado"] == estado


@pytest.mark.asyncio
async def test_retirar_rechaza_fecha_ausente(api):
    incidencia = await _crear_con_antiguedad(api, timedelta(minutes=5))
    await api.db.incidencias_campus.update_one(
        {"_id": ObjectId(incidencia["_id"])}, {"$unset": {"fecha_creacion": ""}}
    )
    respuesta = await _retirar(api, incidencia["_id"])
    assert respuesta.status_code == 409


@pytest.mark.asyncio
async def test_doble_retiro_concurrente(api):
    incidencia = await _crear_con_antiguedad(api, timedelta(minutes=5))
    respuestas = await asyncio.gather(
        _retirar(api, incidencia["_id"]),
        _retirar(api, incidencia["_id"]),
    )
    assert sorted(r.status_code for r in respuestas) == [200, 409]
    documento = await api.doc(incidencia["_id"])
    retiros = [e for e in documento["historial_seguimiento"] if e["estado_nuevo"] == "retirada"]
    assert len(retiros) == 1


@pytest.mark.asyncio
async def test_asignacion_y_retiro_concurrentes_solo_tienen_un_ganador(api):
    incidencia = await _crear_con_antiguedad(api, timedelta(minutes=5))
    retiro, asignacion = await asyncio.gather(
        _retirar(api, incidencia["_id"]),
        api.c.patch(
            f"/incidencias/{incidencia['_id']}/asignacion",
            json={"tecnico_id": str(api.oid("tecnico_infra"))},
            headers=api.h("coordinador_infra"),
        ),
    )
    assert sorted([retiro.status_code, asignacion.status_code]) == [200, 409]
    documento = await api.doc(incidencia["_id"])
    if documento["estado"] == "retirada":
        assert "tecnico_asignado" not in documento
        assert asignacion.status_code == 409
    else:
        assert documento["estado"] == "abierta"
        assert documento["tecnico_asignado"]["usuario_id"] == api.oid("tecnico_infra")
        assert retiro.status_code == 409


@pytest.mark.asyncio
async def test_incidencia_retirada_no_admite_asignacion_ni_nuevo_retiro(api):
    incidencia = await _crear_con_antiguedad(api, timedelta(minutes=5))
    assert (await _retirar(api, incidencia["_id"])).status_code == 200
    segundo_retiro = await _retirar(api, incidencia["_id"])
    asignacion = await api.c.patch(
        f"/incidencias/{incidencia['_id']}/asignacion",
        json={"tecnico_id": str(api.oid("tecnico_infra"))},
        headers=api.h("coordinador_infra"),
    )
    assert segundo_retiro.status_code == 409
    assert asignacion.status_code == 409


@pytest.mark.asyncio
async def test_seguimiento_no_permite_eludir_reglas_de_retiro(api):
    incidencia = await _crear_con_antiguedad(api, timedelta(minutes=5))
    respuesta = await api.c.patch(
        f"/incidencias/{incidencia['_id']}/seguimiento",
        json={"estado_nuevo": "retirada", "comentario": "Intento de eludir reglas", "horas": 0},
        headers=api.h("admin"),
    )
    assert respuesta.status_code == 400
    assert (await api.doc(incidencia["_id"]))["estado"] == "abierta"


@pytest.mark.asyncio
async def test_retirar_requiere_autenticacion_y_id_valido(api):
    sin_token = await api.c.post(f"/incidencias/{ObjectId()}/retirar")
    id_invalido = await api.c.post("/incidencias/no-es-objectid/retirar", headers=api.h("reportante_a"))
    inexistente = await api.c.post(f"/incidencias/{ObjectId()}/retirar", headers=api.h("reportante_a"))
    assert sin_token.status_code == 401
    assert id_invalido.status_code == 400
    assert inexistente.status_code == 404
