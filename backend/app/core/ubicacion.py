"""Resolución segura de identificadores públicos de aulas."""

import re
import secrets
from typing import Any

PATRON_ID_AULA = re.compile(r"^[A-Za-z0-9_-]{22}$")


def generar_id_aula() -> str:
    """Genera 128 bits aleatorios codificados como token URL-safe de 22 caracteres."""
    return secrets.token_urlsafe(16)


def id_aula_valido(aula_id: str) -> bool:
    return PATRON_ID_AULA.fullmatch(aula_id) is not None


async def resolver_ubicacion(aula_id: str, db: Any | None = None) -> dict[str, Any] | None:
    """Devuelve solo la ubicación pública de un aula activa o ``None``."""
    if not id_aula_valido(aula_id):
        return None
    if db is None:
        # Importación diferida: generar/validar IDs no necesita cargar la configuración de la app.
        from app.core.db import get_db

        db = get_db()
    base = db
    aula = await base.aulas.find_one(
        {"id_publico": aula_id, "activa": True},
        {"_id": 0, "id_publico": 1, "edificio": 1, "piso": 1, "aula": 1},
    )
    return aula
