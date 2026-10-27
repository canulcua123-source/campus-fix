import asyncio
import copy
from datetime import datetime, timedelta, timezone

import pytest
from bson import ObjectId
from pydantic import ValidationError
from pymongo.errors import DuplicateKeyError

from app.schemas.ia import EventoIAIn, OfertaIAInterna
from app.services.ia_eventos import (
    EventoIAConflictivo,
    OfertaIAAjena,
    OfertaIANoEncontrada,
    OfertaIAVencida,
    registrar_evento_cliente,
    registrar_oferta,
)

SECRETO = "s" * 64
AHORA = datetime(2026, 10, 25, 18, tzinfo=timezone.utc)


class ColeccionEventosFalsa:
    def __init__(self):
        self.documentos: dict[str, dict] = {}
        self.cerrojo = asyncio.Lock()

    async def insert_one(self, documento):
        async with self.cerrojo:
            clave = documento["analisis_id"]
            if clave in self.documentos:
                raise DuplicateKeyError("duplicado")
            guardado = copy.deepcopy(documento)
            guardado["_id"] = ObjectId()
            self.documentos[clave] = guardado
            return type("Resultado", (), {"inserted_id": guardado["_id"]})()

    async def find_one(self, filtro, proyeccion=None):
        documento = self.documentos.get(filtro.get("analisis_id"))
        if documento is None:
            return None
        if proyeccion is None:
            return copy.deepcopy(documento)
        return {
            clave: copy.deepcopy(documento[clave])
            for clave, incluir in proyeccion.items()
            if incluir and clave in documento
        }

    async def find_one_and_update(self, filtro, actualizacion, return_document=None):
        del return_document
        async with self.cerrojo:
            documento = self.documentos.get(filtro["analisis_id"])
            if documento is None or documento.get("actor_clave") != filtro.get("actor_clave"):
                return None
            if filtro.get("resultado_final") == {"$exists": False} and "resultado_final" in documento:
                return None
            documento.update(copy.deepcopy(actualizacion["$set"]))
            return copy.deepcopy(documento)


class BaseFalsa:
    def __init__(self):
        self.ia_eventos = ColeccionEventosFalsa()


def oferta(**cambios):
    datos = {
        "modo": "agentico",
        "modelo": "modelo-prueba",
        "version_prompt": "v2",
        "confianza": 0.91,
        "campos_autollenados": ["titulo", "descripcion"],
        "proveedor": "claude",
        "categoria": "infraestructura",
        "latencia_ia_ms": 1250,
        "resultado_ia": "ok",
    }
    datos.update(cambios)
    return OfertaIAInterna.model_validate(datos)


def test_evento_http_rechaza_campos_internos_y_motivo_incoherente():
    with pytest.raises(ValidationError):
        EventoIAIn(analisis_id="a" * 32, evento="deshecho", costo_estimado_usd=99)
    with pytest.raises(ValidationError):
        EventoIAIn(analisis_id="a" * 32, evento="deshecho", motivo="usuario_edito")


@pytest.mark.asyncio
async def test_ia_evento_registrado():
    db = BaseFalsa()
    actor = ObjectId()
    creada = await registrar_oferta(
        db,
        actor_id=actor,
        secreto=SECRETO,
        datos=oferta(),
        analisis_id="a" * 32,
        ahora=AHORA,
    )
    resultado = await registrar_evento_cliente(
        db,
        analisis_id=creada.analisis_id,
        evento="editado",
        actor_id=actor,
        secreto=SECRETO,
        ahora=AHORA + timedelta(seconds=5),
    )
    documento = db.ia_eventos.documentos[creada.analisis_id]

    assert resultado.registrado is True
    assert documento["evento"] == "editado"
    assert documento["editado"] is True
    assert "correo" not in documento and "nombre" not in documento and "usuario_id" not in documento
    assert documento["actor_clave"] != str(actor)


@pytest.mark.asyncio
async def test_un_evento_final_por_oferta():
    db = BaseFalsa()
    actor = ObjectId()
    await registrar_oferta(db, actor_id=actor, secreto=SECRETO, datos=oferta(), analisis_id="b" * 32, ahora=AHORA)
    resultados = await asyncio.gather(
        *[
            registrar_evento_cliente(
                db,
                analisis_id="b" * 32,
                evento="deshecho",
                actor_id=actor,
                secreto=SECRETO,
                ahora=AHORA + timedelta(seconds=10),
            )
            for _ in range(2)
        ]
    )
    assert sum(resultado.registrado for resultado in resultados) == 1
    assert all(resultado.evento == "deshecho" and resultado.es_final for resultado in resultados)

    with pytest.raises(EventoIAConflictivo):
        await registrar_evento_cliente(
            db,
            analisis_id="b" * 32,
            evento="fallback",
            actor_id=actor,
            secreto=SECRETO,
            ahora=AHORA + timedelta(seconds=11),
        )
    assert db.ia_eventos.documentos["b" * 32]["resultado_final"] == "deshecho"


@pytest.mark.asyncio
async def test_reintento_del_mismo_resultado_sigue_siendo_idempotente_tras_expirar():
    db = BaseFalsa()
    actor = ObjectId()
    await registrar_oferta(
        db,
        actor_id=actor,
        secreto=SECRETO,
        datos=oferta(),
        analisis_id="d" * 32,
        vigencia=timedelta(seconds=1),
        ahora=AHORA,
    )
    primero = await registrar_evento_cliente(
        db,
        analisis_id="d" * 32,
        evento="deshecho",
        actor_id=actor,
        secreto=SECRETO,
        ahora=AHORA + timedelta(milliseconds=500),
    )
    repetido = await registrar_evento_cliente(
        db,
        analisis_id="d" * 32,
        evento="deshecho",
        actor_id=actor,
        secreto=SECRETO,
        ahora=AHORA + timedelta(seconds=2),
    )

    assert primero.registrado is True
    assert repetido.registrado is False
    assert repetido.es_final is True


@pytest.mark.asyncio
async def test_oferta_inexistente_ajena_y_vencida_se_rechazan():
    db = BaseFalsa()
    actor = ObjectId()
    with pytest.raises(OfertaIANoEncontrada):
        await registrar_evento_cliente(
            db, analisis_id="c" * 32, evento="editado", actor_id=actor, secreto=SECRETO, ahora=AHORA
        )
    await registrar_oferta(
        db,
        actor_id=actor,
        secreto=SECRETO,
        datos=oferta(),
        analisis_id="c" * 32,
        vigencia=timedelta(seconds=1),
        ahora=AHORA,
    )
    with pytest.raises(OfertaIAAjena):
        await registrar_evento_cliente(
            db,
            analisis_id="c" * 32,
            evento="editado",
            actor_id=ObjectId(),
            secreto=SECRETO,
            ahora=AHORA,
        )
    with pytest.raises(OfertaIAVencida):
        await registrar_evento_cliente(
            db,
            analisis_id="c" * 32,
            evento="editado",
            actor_id=actor,
            secreto=SECRETO,
            ahora=AHORA + timedelta(seconds=2),
        )
