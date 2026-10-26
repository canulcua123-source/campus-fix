import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from bson import ObjectId
from fastapi import HTTPException
from pydantic import ValidationError

os.environ["JWT_SECRET"] = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0"

import app.routers.incidencias as router_incidencias
from app.dominio.estados import (
    TRANSICIONES,
    AccionReportanteInvalida,
    validar_confirmacion_reportante,
    validar_reapertura_reportante,
)
from app.schemas.incidencia import ComentarioReportanteIn, ConfirmacionIn, TomarIncidenciaIn


class ColeccionFalsa:
    def __init__(self, documento: dict | None = None, matched_count: int = 1):
        self.documento = documento
        self.matched_count = matched_count
        self.filtro = None
        self.update = None
        self.update_calls = 0

    async def find_one(self, filtro, proyeccion=None):
        return self.documento

    async def update_one(self, filtro, update):
        self.update_calls += 1
        self.filtro = filtro
        self.update = update
        return SimpleNamespace(matched_count=self.matched_count)


def _usuario(*, rol: str = "reportante", alcance: str = "propio") -> dict:
    return {
        "_id": ObjectId(),
        "nombre": "Usuario de prueba",
        "rol": rol,
        "areas": ["infraestructura"],
        "_alcance": alcance,
        "_permisos": ["incidencias:ver", "seguimiento:registrar"],
    }


def _usar_coleccion(monkeypatch, coleccion: ColeccionFalsa) -> None:
    db = SimpleNamespace(incidencias_campus=coleccion)
    monkeypatch.setattr(router_incidencias, "get_db", lambda: db)


def test_reglas_confirmacion_y_transiciones_previas():
    validar_confirmacion_reportante("resuelta")
    with pytest.raises(AccionReportanteInvalida):
        validar_confirmacion_reportante("en_proceso")
    assert TRANSICIONES["resuelta"] == ["cerrada", "en_proceso"]
    assert "abierta" not in TRANSICIONES["resuelta"]


def test_reapertura_dentro_fuera_y_limite_exacto():
    ahora = datetime(2026, 10, 24, 18, 0, tzinfo=timezone.utc)
    validar_reapertura_reportante("resuelta", ahora - timedelta(days=1), ahora)
    validar_reapertura_reportante("resuelta", ahora - timedelta(days=7), ahora)
    for fecha in (ahora - timedelta(days=7, microseconds=1), ahora + timedelta(microseconds=1), None):
        with pytest.raises(AccionReportanteInvalida):
            validar_reapertura_reportante("resuelta", fecha, ahora)
    with pytest.raises(AccionReportanteInvalida):
        validar_reapertura_reportante("cerrada", ahora, ahora)


@pytest.mark.parametrize(
    "modelo,cuerpo",
    [
        (ComentarioReportanteIn, {"comentario": ""}),
        (ComentarioReportanteIn, {"comentario": "abc"}),
        (ComentarioReportanteIn, {"comentario": "x" * 1001}),
        (ComentarioReportanteIn, {"comentario": "Comentario valido", "extra": True}),
        (ConfirmacionIn, {"accion": "otra"}),
        (ConfirmacionIn, {"accion": "confirmar", "comentario": "abc"}),
        (ConfirmacionIn, {"accion": "confirmar", "extra": True}),
        (TomarIncidenciaIn, {"tecnico_id": "0" * 24}),
    ],
)
def test_contratos_rechazan_entradas_invalidas(modelo, cuerpo):
    with pytest.raises(ValidationError):
        modelo.model_validate(cuerpo)


def test_comentario_valido_y_confirmacion_opcional():
    assert (
        ComentarioReportanteIn(comentario="  Informacion adicional valida  ").comentario
        == "Informacion adicional valida"
    )
    assert ConfirmacionIn(accion="confirmar").comentario is None


@pytest.mark.asyncio
async def test_confirmacion_atomica_con_historial_acotado(monkeypatch):
    coleccion = ColeccionFalsa()
    _usar_coleccion(monkeypatch, coleccion)
    usuario = _usuario()

    respuesta = await router_incidencias.confirmar_o_reabrir.__wrapped__(
        None,
        str(ObjectId()),
        ConfirmacionIn(accion="confirmar"),
        usuario,
    )

    assert respuesta == {"ok": True, "estado": "cerrada"}
    assert coleccion.filtro["$and"][0]["estado"] == "resuelta"
    assert {"reportante.usuario_id": usuario["_id"]} in coleccion.filtro["$and"]
    assert set(coleccion.update) == {"$set", "$push"}
    push = coleccion.update["$push"]["historial_seguimiento"]
    assert push["$slice"] == -router_incidencias.MAX_HISTORIAL
    entrada = push["$each"][0]
    assert entrada["usuario_id"] == usuario["_id"]
    assert entrada["estado_nuevo"] == "cerrada"
    assert entrada["horas"] == 0
    assert entrada["fecha"].tzinfo is not None


@pytest.mark.asyncio
async def test_reapertura_atomica_filtra_plazo_y_elimina_fecha(monkeypatch):
    coleccion = ColeccionFalsa()
    _usar_coleccion(monkeypatch, coleccion)
    usuario = _usuario()

    respuesta = await router_incidencias.confirmar_o_reabrir.__wrapped__(
        None,
        str(ObjectId()),
        ConfirmacionIn(accion="reabrir", comentario="La falla continua activa"),
        usuario,
    )

    assert respuesta["estado"] == "abierta"
    temporal = next(c["fecha_resolucion"] for c in coleccion.filtro["$and"] if "fecha_resolucion" in c)
    assert temporal["$lte"] - temporal["$gte"] == timedelta(days=7)
    assert coleccion.update["$unset"] == {"fecha_resolucion": ""}
    assert "horas_invertidas" not in str(coleccion.update)
    assert "tecnico_asignado" not in str(coleccion.update)


@pytest.mark.asyncio
async def test_comentario_solo_modifica_fecha_e_historial(monkeypatch):
    coleccion = ColeccionFalsa()
    _usar_coleccion(monkeypatch, coleccion)
    usuario = _usuario()

    respuesta = await router_incidencias.comentar_en_espera.__wrapped__(
        None,
        str(ObjectId()),
        ComentarioReportanteIn(comentario="Necesito agregar esta informacion"),
        usuario,
    )

    assert respuesta == {"ok": True, "estado": "en_espera"}
    assert coleccion.filtro["$and"][0]["estado"] == "en_espera"
    assert set(coleccion.update["$set"]) == {"fecha_actualizacion"}
    assert "$inc" not in coleccion.update
    entrada = coleccion.update["$push"]["historial_seguimiento"]["$each"][0]
    assert entrada["estado_nuevo"] == "en_espera"
    assert entrada["horas"] == 0


@pytest.mark.asyncio
async def test_autoasignacion_atomica_sin_cambiar_estado(monkeypatch):
    usuario = _usuario(rol="tecnico", alcance="area")
    coleccion = ColeccionFalsa({"_id": ObjectId(), "estado": "abierta"})
    _usar_coleccion(monkeypatch, coleccion)

    respuesta = await router_incidencias.tomar_incidencia.__wrapped__(None, str(coleccion.documento["_id"]), usuario)

    assert respuesta["estado"] == "abierta"
    assert respuesta["tecnico_asignado"]["usuario_id"] == str(usuario["_id"])
    filtro_base = coleccion.filtro["$and"][0]
    assert filtro_base["estado"] == "abierta"
    assert filtro_base["tecnico_asignado"] == {"$exists": False}
    assert coleccion.filtro["$and"][1]["estado"]["$in"] == ["abierta", "en_proceso", "en_espera"]
    assert "estado" not in coleccion.update["$set"]
    assert "$inc" not in coleccion.update
    entrada = coleccion.update["$push"]["historial_seguimiento"]["$each"][0]
    assert entrada["estado_nuevo"] == "abierta"
    assert entrada["usuario_id"] == usuario["_id"]


@pytest.mark.asyncio
async def test_autoasignacion_rechaza_actor_no_tecnico_y_conflicto(monkeypatch):
    with pytest.raises(HTTPException) as no_tecnico:
        await router_incidencias.tomar_incidencia.__wrapped__(
            None, str(ObjectId()), _usuario(rol="coordinador", alcance="area")
        )
    assert no_tecnico.value.status_code == 403

    usuario = _usuario(rol="tecnico", alcance="area")
    documento = {"_id": ObjectId(), "estado": "abierta", "tecnico_asignado": {"usuario_id": ObjectId()}}
    coleccion = ColeccionFalsa(documento, matched_count=0)
    _usar_coleccion(monkeypatch, coleccion)
    with pytest.raises(HTTPException) as conflicto:
        await router_incidencias.tomar_incidencia.__wrapped__(None, str(documento["_id"]), usuario)
    assert conflicto.value.status_code == 409
    assert coleccion.update_calls == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("estado", ["resuelta", "cerrada", "retirada"])
async def test_autoasignacion_rechaza_estados_terminales(monkeypatch, estado):
    usuario = _usuario(rol="tecnico", alcance="area")
    documento = {"_id": ObjectId(), "estado": estado}
    coleccion = ColeccionFalsa(documento, matched_count=0)
    _usar_coleccion(monkeypatch, coleccion)

    with pytest.raises(HTTPException) as conflicto:
        await router_incidencias.tomar_incidencia.__wrapped__(None, str(documento["_id"]), usuario)

    assert conflicto.value.status_code == 409
    assert coleccion.update_calls == 1


@pytest.mark.asyncio
async def test_autoasignacion_fuera_de_area_es_404(monkeypatch):
    usuario = _usuario(rol="tecnico", alcance="area")
    coleccion = ColeccionFalsa(documento=None)
    _usar_coleccion(monkeypatch, coleccion)

    with pytest.raises(HTTPException) as fuera_de_alcance:
        await router_incidencias.tomar_incidencia.__wrapped__(None, str(ObjectId()), usuario)

    assert fuera_de_alcance.value.status_code == 404
    assert coleccion.update_calls == 0
