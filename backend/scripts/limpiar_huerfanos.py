"""Borra de R2 las evidencias cuya incidencia ya no existe (p. ej. purgada por el TTL de 60 días).

Uso:  python scripts/limpiar_huerfanos.py            # solo lista (simulación)
      python scripts/limpiar_huerfanos.py --borrar   # borra
Los huérfanos de subidas nunca registradas viven en staging/ y los elimina la regla de lifecycle del bucket.
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pymongo import AsyncMongoClient  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.storage import _requerir_cliente  # noqa: E402


async def main() -> None:
    borrar = "--borrar" in sys.argv
    cliente_db = AsyncMongoClient(settings.mongodb_uri)
    db = cliente_db[settings.mongodb_db]
    r2 = _requerir_cliente()
    codigos_vivos = set(await db.incidencias_campus.distinct("codigo"))
    huerfanos = []
    for pagina in r2.get_paginator("list_objects_v2").paginate(Bucket=settings.r2_bucket, Prefix="evidencias/"):
        for obj in pagina.get("Contents", []):
            codigo = obj["Key"].split("/")[1]
            if codigo not in codigos_vivos:
                huerfanos.append(obj["Key"])
    print(f"{len(huerfanos)} objetos huérfanos")
    if borrar:
        for i in range(0, len(huerfanos), 1000):
            lote = [{"Key": k} for k in huerfanos[i:i + 1000]]
            r2.delete_objects(Bucket=settings.r2_bucket, Delete={"Objects": lote})
        print("borrados")
    await cliente_db.close()


if __name__ == "__main__":
    asyncio.run(main())
