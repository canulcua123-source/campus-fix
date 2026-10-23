"""Migra exclusivamente el administrador antiguo al esquema de usuarios de T-008.

Uso:  python scripts/migrar_admin_t008.py             # simulación
      python scripts/migrar_admin_t008.py --aplicar   # aplica el cambio

El script no cambia la contraseña, el rol, los permisos ni el estado del usuario.
"""
import asyncio
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pymongo import AsyncMongoClient  # noqa: E402

from app.core.config import settings  # noqa: E402


async def migrar_admin(db, aplicar: bool = False) -> int:
    admin = await db.usuarios.find_one({"correo": "admin@utm.local"})
    if admin is None:
        print("= no existe admin@utm.local; init_db.py lo creará con el esquema actual")
        return 0

    sets: dict = {}
    unsets: dict[str, str] = {}
    if "schema_version" not in admin:
        sets["schema_version"] = 1
    elif admin["schema_version"] != 1:
        print("! schema_version no es 1; requiere revisión manual y no se modificó")
        return 0

    if "fecha_alta" not in admin:
        fecha_anterior = admin.get("fecha_creacion")
        if not isinstance(fecha_anterior, datetime):
            print("! no existe una fecha_creacion BSON válida; requiere revisión manual y no se modificó")
            return 0
        sets["fecha_alta"] = fecha_anterior
    if "fecha_creacion" in admin:
        unsets["fecha_creacion"] = ""

    if not sets and not unsets:
        print("= admin@utm.local ya cumple la migración T-008")
        return 0
    if not aplicar:
        print("SIMULACIÓN: 1 administrador requiere migración; usa --aplicar después del respaldo")
        return 1

    actualizacion: dict = {}
    if sets:
        actualizacion["$set"] = sets
    if unsets:
        actualizacion["$unset"] = unsets
    resultado = await db.usuarios.update_one({"_id": admin["_id"], "correo": "admin@utm.local"}, actualizacion)
    print(f"OK: {resultado.modified_count} administrador migrado")
    return resultado.modified_count


async def main() -> None:
    cliente = AsyncMongoClient(settings.mongodb_admin_uri or settings.mongodb_uri)
    try:
        await migrar_admin(cliente[settings.mongodb_db], aplicar="--aplicar" in sys.argv)
    finally:
        await cliente.close()


if __name__ == "__main__":
    asyncio.run(main())
