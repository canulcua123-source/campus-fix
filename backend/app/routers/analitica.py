from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.core.config import settings
from app.core.db import get_db
from app.core.limiter import limiter
from app.core.security import filtro_alcance, require_permiso

router = APIRouter(prefix="/analitica", tags=["analitica"])


@router.get("/edificios")
@limiter.limit(lambda: settings.limite_consulta_pesada)
async def por_edificio(request: Request, usuario: Annotated[dict, Depends(require_permiso("analitica:ver"))]):
    # Pipeline 1 (CU-06): eficiencia por edificio sobre incidencias resueltas o cerradas.
    pipeline = [
        {
            "$match": {
                "estado": {"$in": ["resuelta", "cerrada"]},
                "fecha_resolucion": {"$type": "date"},
                **filtro_alcance(usuario),
            }
        },
        {
            "$project": {
                "edificio": "$ubicacion.edificio",
                "horas_invertidas": 1,
                # milisegundos → horas con decimales ($dateDiff por hora solo cuenta cambios de hora completos)
                "horas_resolucion": {"$divide": [{"$subtract": ["$fecha_resolucion", "$fecha_creacion"]}, 3600000]},
            }
        },
        {
            "$group": {
                "_id": "$edificio",
                "total": {"$sum": 1},
                "horas_invertidas": {"$sum": "$horas_invertidas"},
                "horas_resolucion_prom": {"$avg": "$horas_resolucion"},
            }
        },
        {"$sort": {"horas_resolucion_prom": -1}},
        {
            "$project": {
                "_id": 0,
                "edificio": "$_id",
                "total": 1,
                "horas_invertidas": 1,
                "horas_resolucion_prom": {"$round": ["$horas_resolucion_prom", 1]},
            }
        },
    ]
    return [d async for d in await get_db().incidencias_campus.aggregate(pipeline)]


@router.get("/tags")
@limiter.limit(lambda: settings.limite_consulta_pesada)
async def top_tags(request: Request, usuario: Annotated[dict, Depends(require_permiso("analitica:ver"))]):
    pipeline = [
        {"$match": filtro_alcance(usuario)},
        {"$unwind": "$tags"},
        {"$group": {"_id": "$tags", "total": {"$sum": 1}}},
        {"$sort": {"total": -1, "_id": 1}},
        {"$limit": 10},
        {"$project": {"_id": 0, "tag": "$_id", "total": 1}},
    ]
    return [d async for d in await get_db().incidencias_campus.aggregate(pipeline)]
