import asyncio
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from bson import ObjectId
from fastapi import HTTPException

os.environ["JWT_SECRET"] = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0"

import app.routers.incidencias as router_incidencias
from app.dominio.estados import VENTANA_RETIRO, retiro_en_ventana


AHORA = datetime(2026, 10, 25, 18, 0, tzinfo=timezone.utc)


def _usuario(usuario_id: ObjectId | None = None, *, alcance: str = "propio") -> dict:
    return {
        "_id": usuario_id or ObjectId(),
        "nombre": "Reportante de prueba",
        "rol": "reportante",
        "areas": [],
        "_alcance": alcance,
        "_permisos": ["incidencias:ver"],
    }


class ColeccionFalsa:
    def __init__(self, documento: dict | None, matched_count: int):
        self.documento = documento
        self.matched_count = matched_count
        self.filtro = None
        self.update = None

    async def update_one(self, filtro, update):
        self.filtro = filtro
        self.update = update
        return SimpleNamespace(matched_count=self.matched_count)

    async def find_one(self, filtro, proyeccion=None):
        return self.documento


class ColeccionConcurrente:
    def __init__(self, documento: dict):
        self.documento = documento
        self.lock = asyncio.Lock()

    async def update_one(self, filtro, update):
        async with self.lock:
            if self.documento["estado"] != "abierta" or "tecnico_asignado" in self.documento:
                return SimpleNamespace(matched_count=0)
            self.documento.update(update["$set"])
            self.documento.setdefault("historial_seguimiento", []).extend(
                update["$push"]["historial_seguimiento"]["$each"]
            )
            return SimpleNamespace(matched_count=1)

    async def find_one(self, filtro, proyeccion=None):
        return self.documento


def _usar_coleccion(monkeypatch, coleccion) -> None:
    monkeypatch.setattr(
        router_incidencias,
        "get_db",
        lambda: SimpleNamespace(incidencias_campus=coleccion),
    )
    monkeypatch.setattr(router_incidencias, "ahora_utc", lambda: AHORA)


def test_ventana_retiro_inclusiva_y_fechas_invalidas():
    assert retiro_en_ventana(AHORA - timedelta(minutes=14), AHORA)
    assert retiro_en_ventana(AHORA - VENTANA_RETIRO, AHORA)
    assert not retiro_en_ventana(AHORA - VENTANA_RETIRO - timedelta(microseconds=1), AHORA)
    assert not retiro_en_ventana(AHORA + timedelta(microseconds=1), AHORA)
    assert not retiro_en_ventana(None, AHORA)
    assert not retiro_en_ventana("2026-10-25T17:55:00Z", AHORA)  # type: ignore[arg-type]
    assert not retiro_en_ventana(AHORA.replace(tzinfo=None), AHORA)


@pytest.mark.asyncio
async def test_retiro_atomico_incluye_todas_las_precondiciones(monkeypatch):
    usuario = _usuario()
    incidencia_id = ObjectId()
    coleccion = ColeccionFalsa(None, 1)
    _usar_coleccion(monkeypatch, coleccion)

    respuesta = await router_incidencias.retirar_incidencia.__wrapped__(
        None, str(incidencia_id), usuario
    )

    assert respuesta == {"ok": True, "estado": "retirada"}
    base, alcance = coleccion.filtro["$and"]
    assert base == {
        "_id": incidencia_id,
        "reportante.usuario_id": usuario["_id"],
        "estado": "abierta",
        "tecnico_asignado": {"$exists": False},
        "fecha_creacion": {
            "$type": "date",
            "$gte": AHORA - VENTANA_RETIRO,
            "$lte": AHORA,
        },
    }
    assert alcance == {"reportante.usuario_id": usuario["_id"]}
    assert coleccion.update["$set"] == {"estado": "retirada", "fecha_actualizacion": AHORA}
    push = coleccion.update["$push"]["historial_seguimiento"]
    assert push["$slice"] == -router_incidencias.MAX_HISTORIAL
    assert push["$each"][0]["estado_nuevo"] == "retirada"
    assert push["$each"][0]["usuario_id"] == usuario["_id"]


@pytest.mark.asyncio
async def test_retiro_no_elegible_devuelve_409(monkeypatch):
    usuario = _usuario()
    documento = {"_id": ObjectId(), "reportante": {"usuario_id": usuario["_id"]}}
    _usar_coleccion(monkeypatch, ColeccionFalsa(documento, 0))

    with pytest.raises(HTTPException) as conflicto:
        await router_incidencias.retirar_incidencia.__wrapped__(
            None, str(documento["_id"]), usuario
        )
    assert conflicto.value.status_code == 409
    assert conflicto.value.detail == "La incidencia ya no puede retirarse"


@pytest.mark.asyncio
async def test_retiro_ajeno_no_revela_existencia(monkeypatch):
    usuario = _usuario(alcance="global")
    documento = {"_id": ObjectId(), "reportante": {"usuario_id": ObjectId()}}
    _usar_coleccion(monkeypatch, ColeccionFalsa(documento, 0))

    with pytest.raises(HTTPException) as no_encontrada:
        await router_incidencias.retirar_incidencia.__wrapped__(
            None, str(documento["_id"]), usuario
        )
    assert no_encontrada.value.status_code == 404


@pytest.mark.asyncio
async def test_doble_retiro_concurrente_solo_actualiza_una_vez(monkeypatch):
    usuario = _usuario()
    documento = {
        "_id": ObjectId(),
        "reportante": {"usuario_id": usuario["_id"]},
        "estado": "abierta",
        "fecha_creacion": AHORA - timedelta(minutes=5),
        "historial_seguimiento": [],
    }
    coleccion = ColeccionConcurrente(documento)
    _usar_coleccion(monkeypatch, coleccion)

    resultados = await asyncio.gather(
        *(
            router_incidencias.retirar_incidencia.__wrapped__(
                None, str(documento["_id"]), usuario
            )
            for _ in range(2)
        ),
        return_exceptions=True,
    )

    exitos = [r for r in resultados if isinstance(r, dict)]
    conflictos = [r for r in resultados if isinstance(r, HTTPException)]
    assert exitos == [{"ok": True, "estado": "retirada"}]
    assert len(conflictos) == 1 and conflictos[0].status_code == 409
    assert documento["estado"] == "retirada"
    assert [e["estado_nuevo"] for e in documento["historial_seguimiento"]] == ["retirada"]
