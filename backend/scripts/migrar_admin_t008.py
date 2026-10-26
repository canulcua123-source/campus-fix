"""Migra los usuarios antiguos (incluido admin@utm.local) al esquema de usuarios de T-008.

Uso:  python scripts/migrar_admin_t008.py             # simulación
      python scripts/migrar_admin_t008.py --aplicar   # aplica el cambio

Es idempotente: solo toca documentos sin `schema_version` o con el campo antiguo `fecha_creacion`.
No cambia la contraseña, el rol, los permisos ni el estado de ningún usuario.
En Atlas solo lo ejecuta el líder, después de un respaldo (docs/bd/respaldo.md).
"""

import asyncio
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pymongo import AsyncMongoClient  # noqa: E402

from app.core.config import settings  # noqa: E402

PENDIENTES = {"$or": [{"schema_version": {"$exists": False}}, {"fecha_creacion": {"$exists": True}}]}


def _cambios(usuario: dict) -> tuple[dict, dict] | None:
    """Devuelve ($set, $unset) para un usuario, o None si requiere revisión manual."""
    sets: dict = {}
    unsets: dict[str, str] = {}
    if "schema_version" not in usuario:
        sets["schema_version"] = 1
    elif usuario["schema_version"] != 1:
        return None
    if "fecha_alta" not in usuario:
        fecha_anterior = usuario.get("fecha_creacion")
        if not isinstance(fecha_anterior, datetime):
            return None
        sets["fecha_alta"] = fecha_anterior
    if "fecha_creacion" in usuario:
        unsets["fecha_creacion"] = ""
    return sets, unsets


async def migrar_usuarios(db, aplicar: bool = False) -> int:
    pendientes = [
        u async for u in db.usuarios.find(PENDIENTES, {"schema_version": 1, "fecha_alta": 1, "fecha_creacion": 1})
    ]
    if not pendientes:
        print("= todos los usuarios ya cumplen la migración T-008")
        return 0
    migrables = []
    for usuario in pendientes:
        cambios = _cambios(usuario)
        if cambios is None:
            print(f"! usuario {usuario['_id']} requiere revisión manual y no se modificó")
        elif cambios != ({}, {}):
            migrables.append((usuario["_id"], cambios))
    if not aplicar:
        print(f"SIMULACIÓN: {len(migrables)} usuario(s) requieren migración; usa --aplicar después del respaldo")
        return len(migrables)
    modificados = 0
    for usuario_id, (sets, unsets) in migrables:
        actualizacion: dict = {}
        if sets:
            actualizacion["$set"] = sets
        if unsets:
            actualizacion["$unset"] = unsets
        resultado = await db.usuarios.update_one({"_id": usuario_id}, actualizacion)
        modificados += resultado.modified_count
    print(f"OK: {modificados} usuario(s) migrado(s)")
    return modificados


# Nombre anterior, conservado por compatibilidad con la documentación de T-008.
migrar_admin = migrar_usuarios


async def main() -> None:
    cliente = AsyncMongoClient(settings.mongodb_admin_uri or settings.mongodb_uri)
    try:
        await migrar_usuarios(cliente[settings.mongodb_db], aplicar="--aplicar" in sys.argv)
    finally:
        await cliente.close()


if __name__ == "__main__":
    asyncio.run(main())
