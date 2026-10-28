"""Ciclo de vida auditable de ofertas de IA, sin datos personales."""

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.schemas.ia import EventoIACliente, OfertaIAInterna

EventoFinalIA = Literal["deshecho", "enviado", "duplicado_sumado", "fallback"]
EVENTOS_FINALES = frozenset({"deshecho", "enviado", "duplicado_sumado", "fallback"})
MOTIVOS_PREDETERMINADOS = {
    "deshecho": "usuario_deshizo",
    "editado": "usuario_edito",
    "fallback": "continuo_manual",
}


class OfertaIANoEncontrada(Exception):
    pass


class OfertaIAAjena(Exception):
    pass


class OfertaIAVencida(Exception):
    pass


class EventoIAConflictivo(Exception):
    pass


@dataclass(frozen=True)
class ResultadoRegistroEvento:
    analisis_id: str
    evento: str
    registrado: bool
    es_final: bool


def clave_actor_ia(actor_id: ObjectId | str, secreto: str) -> str:
    """Seudónimo irreversible y aislado del resto de HMAC del proyecto."""
    mensaje = f"utm-desk:ia-eventos:v1:{actor_id}".encode()
    return hmac.new(secreto.encode(), mensaje, hashlib.sha256).hexdigest()


def _ahora_utc(ahora: datetime | None = None) -> datetime:
    valor = ahora or datetime.now(timezone.utc)
    if valor.tzinfo is None or valor.utcoffset() is None:
        raise ValueError("La fecha debe incluir zona horaria")
    return valor.astimezone(timezone.utc)


async def registrar_oferta(
    db: Any,
    *,
    actor_id: ObjectId | str,
    secreto: str,
    datos: OfertaIAInterna,
    analisis_id: str | None = None,
    vigencia: timedelta = timedelta(minutes=30),
    ahora: datetime | None = None,
) -> ResultadoRegistroEvento:
    """Interfaz para T-033/T-036: registra la oferta emitida por un backend confiable."""
    if vigencia <= timedelta(0) or vigencia > timedelta(hours=24):
        raise ValueError("La vigencia de una oferta debe estar entre 0 y 24 horas")
    instante = _ahora_utc(ahora)
    identificador = analisis_id or secrets.token_urlsafe(32)
    documento = {
        "analisis_id": identificador,
        "actor_clave": clave_actor_ia(actor_id, secreto),
        "evento": "ofrecido",
        "fecha": instante,
        "fecha_evento": instante,
        "oferta_expira_en": instante + vigencia,
        "editado": False,
        **datos.model_dump(exclude_none=True),
    }
    try:
        await db.ia_eventos.insert_one(documento)
    except DuplicateKeyError:
        existente = await db.ia_eventos.find_one(
            {"analisis_id": identificador},
            {"actor_clave": 1, "evento": 1},
        )
        if existente is None or not hmac.compare_digest(existente.get("actor_clave", ""), documento["actor_clave"]):
            raise EventoIAConflictivo("El identificador ya está en uso") from None
        return ResultadoRegistroEvento(
            identificador, existente["evento"], False, bool(existente["evento"] in EVENTOS_FINALES)
        )
    return ResultadoRegistroEvento(identificador, "ofrecido", True, False)


async def _cargar_oferta(db: Any, analisis_id: str) -> dict[str, Any]:
    oferta = await db.ia_eventos.find_one(
        {"analisis_id": analisis_id},
        {
            "actor_clave": 1,
            "evento": 1,
            "resultado_final": 1,
            "oferta_expira_en": 1,
        },
    )
    if oferta is None:
        raise OfertaIANoEncontrada
    return oferta


def _verificar_actor(
    oferta: dict[str, Any],
    *,
    actor_id: ObjectId | str,
    secreto: str,
) -> None:
    if not hmac.compare_digest(oferta.get("actor_clave", ""), clave_actor_ia(actor_id, secreto)):
        raise OfertaIAAjena


def _verificar_vigencia(oferta: dict[str, Any], *, ahora: datetime) -> None:
    if oferta["oferta_expira_en"] <= ahora:
        raise OfertaIAVencida


async def registrar_evento_cliente(
    db: Any,
    *,
    analisis_id: str,
    evento: EventoIACliente,
    actor_id: ObjectId | str,
    secreto: str,
    motivo: str | None = None,
    ahora: datetime | None = None,
) -> ResultadoRegistroEvento:
    """Registra una interacción verificable; costo, tokens y resultados exitosos quedan fuera del cliente."""
    instante = _ahora_utc(ahora)
    oferta = await _cargar_oferta(db, analisis_id)
    _verificar_actor(oferta, actor_id=actor_id, secreto=secreto)
    if evento == "editado":
        _verificar_vigencia(oferta, ahora=instante)
        actualizado = await db.ia_eventos.find_one_and_update(
            {
                "analisis_id": analisis_id,
                "actor_clave": oferta["actor_clave"],
                "resultado_final": {"$exists": False},
            },
            {
                "$set": {
                    "evento": "editado",
                    "editado": True,
                    "fecha_evento": instante,
                    "motivo": motivo or MOTIVOS_PREDETERMINADOS[evento],
                }
            },
            return_document=ReturnDocument.AFTER,
        )
        if actualizado is not None:
            return ResultadoRegistroEvento(analisis_id, evento, oferta.get("evento") != "editado", False)
        actual = await _cargar_oferta(db, analisis_id)
        if actual.get("resultado_final") is not None:
            raise EventoIAConflictivo("La oferta ya tiene un resultado final")
        return ResultadoRegistroEvento(analisis_id, evento, False, False)

    return await registrar_resultado_confiable(
        db,
        analisis_id=analisis_id,
        evento=evento,
        actor_id=actor_id,
        secreto=secreto,
        motivo=motivo or MOTIVOS_PREDETERMINADOS[evento],
        ahora=instante,
    )


async def registrar_resultado_confiable(
    db: Any,
    *,
    analisis_id: str,
    evento: EventoFinalIA,
    actor_id: ObjectId | str,
    secreto: str,
    motivo: str | None = None,
    incidencia_id: ObjectId | None = None,
    duracion_toque_folio_ms: int | None = None,
    campos_editados: list[str] | None = None,
    ahora: datetime | None = None,
) -> ResultadoRegistroEvento:
    """Interfaz para T-036/T-038; el resultado final se decide una sola vez mediante CAS en MongoDB.

    ``campos_editados`` (solo con ``enviado``) los calcula el servidor comparando con la sugerencia guardada:
    marca ``editado`` en el mismo CAS para que la tasa de edición no dependa del cliente.
    """
    if evento not in EVENTOS_FINALES:
        raise ValueError("El evento no es un resultado final")
    if duracion_toque_folio_ms is not None and not 0 <= duracion_toque_folio_ms <= 300_000:
        raise ValueError("La duración toque a folio está fuera de rango")
    if (incidencia_id is not None or duracion_toque_folio_ms is not None) and evento != "enviado":
        raise ValueError("La incidencia y su duración solo corresponden al resultado enviado")
    if campos_editados and evento != "enviado":
        raise ValueError("Los campos editados solo corresponden al resultado enviado")

    instante = _ahora_utc(ahora)
    oferta = await _cargar_oferta(db, analisis_id)
    _verificar_actor(oferta, actor_id=actor_id, secreto=secreto)
    if oferta.get("resultado_final") == evento:
        return ResultadoRegistroEvento(analisis_id, evento, False, True)
    if oferta.get("resultado_final") is not None:
        raise EventoIAConflictivo("La oferta ya tiene otro resultado final")
    _verificar_vigencia(oferta, ahora=instante)
    cambios: dict[str, Any] = {
        "evento": evento,
        "resultado_final": evento,
        "fecha_evento": instante,
        "fecha_final": instante,
    }
    if motivo is not None:
        cambios["motivo"] = motivo
    if incidencia_id is not None:
        cambios["incidencia_id"] = incidencia_id
    if duracion_toque_folio_ms is not None:
        cambios["duracion_toque_folio_ms"] = duracion_toque_folio_ms
    if campos_editados:
        cambios["editado"] = True
        cambios["campos_editados_por_usuario"] = list(dict.fromkeys(campos_editados))

    actualizado = await db.ia_eventos.find_one_and_update(
        {
            "analisis_id": analisis_id,
            "actor_clave": oferta["actor_clave"],
            "resultado_final": {"$exists": False},
        },
        {"$set": cambios},
        return_document=ReturnDocument.AFTER,
    )
    if actualizado is not None:
        return ResultadoRegistroEvento(analisis_id, evento, True, True)

    actual = await _cargar_oferta(db, analisis_id)
    if actual.get("resultado_final") == evento:
        return ResultadoRegistroEvento(analisis_id, evento, False, True)
    raise EventoIAConflictivo("La oferta ya tiene otro resultado final")


__all__ = [
    "EventoIAConflictivo",
    "OfertaIAAjena",
    "OfertaIANoEncontrada",
    "OfertaIAVencida",
    "ResultadoRegistroEvento",
    "clave_actor_ia",
    "registrar_evento_cliente",
    "registrar_oferta",
    "registrar_resultado_confiable",
]
