"""Conversión de documentos de MongoDB a JSON (ObjectId anidados → str)."""
from typing import Any

from bson import ObjectId


def a_json(valor: Any) -> Any:
    if isinstance(valor, ObjectId):
        return str(valor)
    if isinstance(valor, dict):
        return {k: a_json(v) for k, v in valor.items() if k != "password_hash"}
    if isinstance(valor, list):
        return [a_json(v) for v in valor]
    return valor
