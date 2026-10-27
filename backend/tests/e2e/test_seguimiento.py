import asyncio
from datetime import datetime, timedelta, timezone

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


async def test_historial_conserva_contrato_documentado(api):
    inc = await api.crear("reportante_a", "infraestructura")
    creado = (await api.doc(inc["_id"]))["historial_seguimiento"][-1]
    assert set(creado) == {"fecha", "usuario_id", "estado_nuevo", "comentario", "horas"}
    assert isinstance(creado["fecha"], datetime)
    assert isinstance(creado["usuario_id"], ObjectId)
    assert creado["estado_nuevo"] == "abierta"
    assert "estado_anterior" not in creado

    r = await api.seguimiento(inc["_id"], "en_proceso", quien="tecnico_infra")
    assert r.status_code == 200, r.text
    transicion = (await api.doc(inc["_id"]))["historial_seguimiento"][-1]
    assert set(transicion) == {"fecha", "usuario_id", "estado_nuevo", "comentario", "horas"}
    assert transicion["estado_nuevo"] == "en_proceso"
    assert "estado_anterior" not in transicion


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


@pytest.mark.parametrize(
    "body",
    [
        {"estado_nuevo": "en_proceso", "comentario": "abc", "horas": 1},
        {"estado_nuevo": "en_proceso", "comentario": "x" * 1001, "horas": 1},
        {"estado_nuevo": "en_proceso", "comentario": "Comentario ok", "horas": -1},
        {"estado_nuevo": "en_proceso", "comentario": "Comentario ok", "horas": 25},
        {"estado_nuevo": "inventado", "comentario": "Comentario ok", "horas": 1},
        {"estado_nuevo": {"$ne": "x"}, "comentario": "Comentario ok", "horas": 1},
        {"estado_nuevo": "en_proceso", "comentario": "Comentario ok"},
        {"estado_nuevo": "en_proceso", "comentario": "Comentario ok", "horas": 1, "extra": 1},
    ],
    ids=[
        "comentario_corto",
        "comentario_largo",
        "horas_neg",
        "horas_25",
        "estado_invalido",
        "nosql",
        "sin_horas",
        "extra",
    ],
)
async def test_seguimiento_validacion(api, body):
    inc = await api.crear()
    r = await api.c.patch(f"/incidencias/{inc['_id']}/seguimiento", json=body, headers=api.h("tecnico_infra"))
    assert r.status_code == 400, r.text
    assert (await api.doc(inc["_id"]))["estado"] == "abierta"


async def test_seguimiento_permisos_y_alcance(api):
    inc = await api.crear("reportante_a", "infraestructura", edificio="Edificio B")
    antes = await api.doc(inc["_id"])
    for quien, esperado in (
        ("reportante_a", {403}),
        ("directivo", {403}),
        ("tecnico_redes", {404, 409}),
        ("jefe_a", {404, 409}),
    ):
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


async def _confirmacion(api, inc_id, accion, quien="reportante_a", comentario=None):
    body = {"accion": accion}
    if comentario is not None:
        body["comentario"] = comentario
    return await api.c.post(
        f"/incidencias/{inc_id}/confirmacion",
        json=body,
        headers=api.h(quien) if quien else {},
    )


async def _comentario(api, inc_id, quien="reportante_a", comentario="Informacion adicional del reportante"):
    return await api.c.post(
        f"/incidencias/{inc_id}/comentarios",
        json={"comentario": comentario},
        headers=api.h(quien) if quien else {},
    )


async def _tomar(api, inc_id, quien="tecnico_infra"):
    return await api.c.post(
        f"/incidencias/{inc_id}/tomar",
        headers=api.h(quien) if quien else {},
    )


async def test_reportante_confirma_cierra(api):
    inc = await api.crear_en("resuelta", "reportante_a", "infraestructura")
    antes = await api.doc(inc["_id"])
    fecha_resolucion = antes["fecha_resolucion"]

    r = await _confirmacion(api, inc["_id"], "confirmar")

    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "estado": "cerrada"}
    despues = await api.doc(inc["_id"])
    assert despues["estado"] == "cerrada"
    assert despues["fecha_resolucion"] == fecha_resolucion
    assert despues["horas_invertidas"] == antes["horas_invertidas"]
    assert len(despues["historial_seguimiento"]) == len(antes["historial_seguimiento"]) + 1
    entrada = despues["historial_seguimiento"][-1]
    assert entrada["usuario_id"] == api.oid("reportante_a")
    assert entrada["estado_nuevo"] == "cerrada"
    assert entrada["horas"] == 0
    assert entrada["fecha"].tzinfo is not None

    repetida = await _confirmacion(api, inc["_id"], "confirmar")
    assert repetida.status_code == 409
    assert len((await api.doc(inc["_id"]))["historial_seguimiento"]) == len(despues["historial_seguimiento"])


async def test_reabrir_dentro_7_dias(api):
    inc = await api.crear_en("resuelta", "reportante_a", "infraestructura")
    antes = await api.doc(inc["_id"])

    r = await _confirmacion(
        api,
        inc["_id"],
        "reabrir",
        comentario="La falla continua despues de la reparacion",
    )

    assert r.status_code == 200, r.text
    despues = await api.doc(inc["_id"])
    assert despues["estado"] == "abierta"
    assert "fecha_resolucion" not in despues
    assert despues["codigo"] == antes["codigo"]
    assert despues["categoria"] == antes["categoria"]
    assert despues["reportante"] == antes["reportante"]
    assert despues["horas_invertidas"] == antes["horas_invertidas"]
    assert len(despues["historial_seguimiento"]) == len(antes["historial_seguimiento"]) + 1
    assert despues["historial_seguimiento"][-1]["comentario"] == "La falla continua despues de la reparacion"

    tecnica = await api.crear_en("resuelta", "reportante_a", "infraestructura")
    assert (await api.seguimiento(tecnica["_id"], "en_proceso", quien="tecnico_infra")).status_code == 200


async def test_reabrir_fuera_plazo_409(api):
    inc = await api.crear_en("resuelta", "reportante_a", "infraestructura")
    vencida = datetime.now(timezone.utc) - timedelta(days=7, seconds=1)
    vencida = vencida.replace(microsecond=vencida.microsecond // 1000 * 1000)  # Mongo guarda milisegundos
    await api.db.incidencias_campus.update_one(
        {"_id": ObjectId(inc["_id"])},
        {"$set": {"fecha_resolucion": vencida}},
    )
    antes = await api.doc(inc["_id"])

    r = await _confirmacion(api, inc["_id"], "reabrir", comentario="La falla continua activa")

    assert r.status_code == 409, r.text
    despues = await api.doc(inc["_id"])
    assert despues["estado"] == "resuelta"
    assert despues["fecha_resolucion"] == vencida
    assert despues["historial_seguimiento"] == antes["historial_seguimiento"]
    assert despues["horas_invertidas"] == antes["horas_invertidas"]
    assert despues.get("tecnico_asignado") == antes.get("tecnico_asignado")


async def test_comentario_solo_en_espera(api):
    inc = await api.crear_en("en_espera", "reportante_a", "infraestructura")
    antes = await api.doc(inc["_id"])
    r = await _comentario(api, inc["_id"], comentario="El equipo muestra ahora otro mensaje")
    assert r.status_code == 200, r.text
    despues = await api.doc(inc["_id"])
    assert despues["estado"] == "en_espera"
    assert despues["horas_invertidas"] == antes["horas_invertidas"]
    assert despues["fecha_actualizacion"] >= antes["fecha_actualizacion"]
    assert len(despues["historial_seguimiento"]) == len(antes["historial_seguimiento"]) + 1
    assert despues["historial_seguimiento"][-1]["comentario"] == "El equipo muestra ahora otro mensaje"

    for estado in ("abierta", "en_proceso", "resuelta", "cerrada"):
        otra = await api.crear_en(estado, "reportante_a", "infraestructura")
        original = await api.doc(otra["_id"])
        invalida = await _comentario(api, otra["_id"])
        assert invalida.status_code == 409, f"{estado}: {invalida.text}"
        assert (await api.doc(otra["_id"])) == original

    ajena = await _comentario(api, inc["_id"], quien="reportante_b")
    assert ajena.status_code == 404


async def test_tomar_concurrente_un_ganador(api):
    inc = await api.crear("reportante_a", "infraestructura")
    antes = await api.doc(inc["_id"])

    r1, r2 = await asyncio.gather(
        _tomar(api, inc["_id"], "tecnico_infra"),
        _tomar(api, inc["_id"], "tecnico_infra2"),
    )

    assert sorted([r1.status_code, r2.status_code]) == [200, 409]
    ganador = r1 if r1.status_code == 200 else r2
    despues = await api.doc(inc["_id"])
    ids = {api.oid("tecnico_infra"), api.oid("tecnico_infra2")}
    assert despues["tecnico_asignado"]["usuario_id"] in ids
    assert ganador.json()["tecnico_asignado"]["usuario_id"] == str(despues["tecnico_asignado"]["usuario_id"])
    assert despues["estado"] == antes["estado"]
    assert len(despues["historial_seguimiento"]) == len(antes["historial_seguimiento"]) + 1
    assert despues["historial_seguimiento"][-1]["usuario_id"] == despues["tecnico_asignado"]["usuario_id"]


async def test_tomar_otra_area_403(api):
    """El nombre historico dice 403; el contrato BOLA vigente exige 404 por alcance."""
    inc = await api.crear("reportante_a", "computo_redes")
    antes = await api.doc(inc["_id"])

    r = await _tomar(api, inc["_id"], "tecnico_infra")

    assert r.status_code == 404
    assert await api.doc(inc["_id"]) == antes


async def test_acciones_f2_validacion_autorizacion(api):
    inc = await api.crear_en("resuelta", "reportante_a", "infraestructura")
    assert (await _confirmacion(api, inc["_id"], "confirmar", quien=None)).status_code == 401
    assert (await _confirmacion(api, inc["_id"], "otra")).status_code == 400
    assert (await _confirmacion(api, "id-invalido", "confirmar")).status_code == 400
    assert (await _confirmacion(api, inc["_id"], "confirmar", quien="directivo")).status_code == 403

    disponible = await api.crear("reportante_a", "infraestructura")
    assert (await _tomar(api, disponible["_id"], quien=None)).status_code == 401
    assert (await _tomar(api, disponible["_id"], quien="reportante_a")).status_code == 403
    assert (await _tomar(api, disponible["_id"], quien="coordinador_infra")).status_code == 403
    con_otro_tecnico = await api.c.post(
        f"/incidencias/{disponible['_id']}/tomar",
        json={"tecnico_id": str(api.oid("tecnico_infra2"))},
        headers=api.h("tecnico_infra"),
    )
    assert con_otro_tecnico.status_code == 400

    espera = await api.crear_en("en_espera", "reportante_a", "infraestructura")
    assert (await _comentario(api, espera["_id"], comentario="abc")).status_code == 400
    extra = await api.c.post(
        f"/incidencias/{espera['_id']}/comentarios",
        json={"comentario": "Comentario suficientemente largo", "extra": True},
        headers=api.h("reportante_a"),
    )
    assert extra.status_code == 400


assert set(RUTAS) == set(ESTADOS)
