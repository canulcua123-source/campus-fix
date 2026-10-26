"""Registro best effort de acciones administrativas con resúmenes seguros."""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Literal

from bson import ObjectId

from app.core.db import get_db

AccionAuditoria = Literal["crear", "editar"]
RecursoAuditoria = Literal["usuarios", "roles", "categorias"]

ACCIONES_AUDITORIA = {"crear", "editar"}
RECURSOS_AUDITORIA = {"usuarios", "roles", "categorias"}

logger = logging.getLogger(__name__)


def _lista_texto(valor: Any, limite: int) -> list[str] | None:
    if not isinstance(valor, list) or not all(isinstance(elemento, str) for elemento in valor):
        return None
    return list(valor[:limite])


def resumir_usuario(documento: dict[str, Any]) -> dict[str, Any]:
    """Conserva solo estado operativo; nunca identidad personal ni credenciales."""
    resumen: dict[str, Any] = {}
    if isinstance(documento.get("rol"), str):
        resumen["rol"] = documento["rol"]
    if type(documento.get("activo")) is bool:
        resumen["activo"] = documento["activo"]
    areas = _lista_texto(documento.get("areas"), 3)
    edificios = _lista_texto(documento.get("edificios"), 20)
    if areas is not None:
        resumen["areas"] = areas
    if edificios is not None:
        resumen["edificios"] = edificios
    if isinstance(documento.get("tipo_reportante"), str):
        resumen["tipo_reportante"] = documento["tipo_reportante"]
    return resumen


def resumir_rol(documento: dict[str, Any]) -> dict[str, Any]:
    """Resume un rol sin copiar la lista completa de permisos."""
    resumen: dict[str, Any] = {}
    if isinstance(documento.get("clave"), str):
        resumen["clave"] = documento["clave"]
    if isinstance(documento.get("alcance"), str):
        resumen["alcance"] = documento["alcance"]
    if isinstance(documento.get("permisos"), list):
        resumen["cantidad_permisos"] = len(documento["permisos"])
    if type(documento.get("sistema")) is bool:
        resumen["sistema"] = documento["sistema"]
    return resumen


def resumir_categoria(documento: dict[str, Any]) -> dict[str, Any]:
    """Resume la definición de categoría sin copiar su arreglo de campos."""
    resumen: dict[str, Any] = {}
    if isinstance(documento.get("clave"), str):
        resumen["clave"] = documento["clave"]
    if type(documento.get("version")) is int:
        resumen["version"] = documento["version"]
    if type(documento.get("activa")) is bool:
        resumen["activa"] = documento["activa"]
    if isinstance(documento.get("prefijo"), str):
        resumen["prefijo"] = documento["prefijo"]
    if isinstance(documento.get("campos"), list):
        resumen["cantidad_campos"] = len(documento["campos"])
    if type(documento.get("sistema")) is bool:
        resumen["sistema"] = documento["sistema"]
    return resumen


def resumir_recurso(recurso: RecursoAuditoria, documento: dict[str, Any]) -> dict[str, Any]:
    resumidores = {
        "usuarios": resumir_usuario,
        "roles": resumir_rol,
        "categorias": resumir_categoria,
    }
    return resumidores[recurso](documento)


def construir_evento_auditoria(
    *,
    actor: dict[str, Any],
    accion: AccionAuditoria,
    recurso: RecursoAuditoria,
    recurso_id: str,
    despues: dict[str, Any],
    antes: dict[str, Any] | None = None,
    ahora: datetime | None = None,
) -> dict[str, Any]:
    """Construye un evento pequeño a partir de listas positivas por recurso."""
    actor_id = actor.get("_id")
    if not isinstance(actor_id, ObjectId):
        raise ValueError("El actor de auditoría no tiene un ObjectId válido")
    if accion not in ACCIONES_AUDITORIA or recurso not in RECURSOS_AUDITORIA:
        raise ValueError("Acción o recurso de auditoría no permitido")
    if not isinstance(recurso_id, str) or not 1 <= len(recurso_id) <= 64:
        raise ValueError("Identificador de recurso inválido")
    fecha = ahora or datetime.now(timezone.utc)
    if fecha.tzinfo is None or fecha.utcoffset() is None:
        raise ValueError("La fecha de auditoría debe incluir zona horaria")

    evento: dict[str, Any] = {
        "actor_id": actor_id,
        "accion": accion,
        "recurso": recurso,
        "recurso_id": recurso_id,
        "despues": resumir_recurso(recurso, despues),
        "fecha": fecha.astimezone(timezone.utc),
    }
    if antes is not None:
        evento["antes"] = resumir_recurso(recurso, antes)
    if accion == "editar" and "antes" not in evento:
        raise ValueError("Una edición auditada requiere el estado anterior")
    return evento


async def registrar_auditoria(
    *,
    actor: dict[str, Any],
    accion: AccionAuditoria,
    recurso: RecursoAuditoria,
    recurso_id: str,
    despues: dict[str, Any],
    antes: dict[str, Any] | None = None,
) -> None:
    """Persiste el evento sin convertir su fallo en error de la operación principal."""
    try:
        evento = construir_evento_auditoria(
            actor=actor,
            accion=accion,
            recurso=recurso,
            recurso_id=recurso_id,
            antes=antes,
            despues=despues,
        )
        await get_db().auditoria.insert_one(evento)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.warning(
            "No se pudo registrar el evento de auditoría",
            extra={
                "auditoria_recurso": recurso,
                "auditoria_accion": accion,
                "auditoria_tipo_error": type(exc).__name__,
            },
        )
