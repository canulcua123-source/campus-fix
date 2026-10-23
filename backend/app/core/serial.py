"""Conversión segura de documentos de MongoDB a valores JSON."""
from datetime import datetime, timezone
from typing import Any

from bson import ObjectId


def a_json(valor: Any) -> Any:
    if isinstance(valor, ObjectId):
        return str(valor)
    if isinstance(valor, datetime):
        if valor.tzinfo is None or valor.utcoffset() is None:
            raise ValueError("No se puede serializar una fecha sin zona horaria")
        return valor.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    if isinstance(valor, dict):
        return {k: a_json(v) for k, v in valor.items() if k != "password_hash"}
    if isinstance(valor, list):
        return [a_json(v) for v in valor]
    return valor
