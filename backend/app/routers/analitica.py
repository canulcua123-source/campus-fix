from collections.abc import Callable
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import TypeAdapter, ValidationError

from app.core.cache import cache_analitica
from app.core.config import settings
from app.core.db import get_db
from app.core.limiter import limiter
from app.core.security import filtro_alcance, require_permiso
from app.core.serial import a_json
from app.schemas.analitica import AnaliticaEdificio, AnaliticaTag, FiltrosAnalitica, ResumenAnalitica

def _validar_filtros_no_duplicados(request: Request) -> None:
    for nombre in ("desde", "hasta", "categoria"):
        if len(request.query_params.getlist(nombre)) > 1:
            raise HTTPException(400, f"El filtro {nombre} no puede repetirse")


router = APIRouter(
    prefix="/analitica",
    tags=["analitica"],
    dependencies=[Depends(_validar_filtros_no_duplicados)],
)
_TIPO_EDIFICIOS = TypeAdapter(list[AnaliticaEdificio])
_TIPO_TAGS = TypeAdapter(list[AnaliticaTag])
_TIPO_RESUMEN = TypeAdapter(ResumenAnalitica)


def _rango_fechas(filtros: FiltrosAnalitica) -> dict[str, Any]:
    desde, hasta = filtros.intervalo_utc()
    rango: dict[str, Any] = {}
    if desde is not None:
        rango["$gte"] = desde
    if hasta is not None:
        rango["$lt"] = hasta
    return rango


def _filtro_efectivo(
    alcance: dict[str, Any],
    filtros: FiltrosAnalitica,
    campo_fecha: str,
    *condiciones: dict[str, Any],
) -> dict[str, Any]:
    partes = [alcance, *condiciones]
    if filtros.categoria is not None:
        partes.append({"categoria": filtros.categoria})
    rango = _rango_fechas(filtros)
    if rango:
        partes.append({campo_fecha: rango})
    return {"$and": partes}


def _cache_compatible(adaptador: TypeAdapter[Any]) -> Callable[[Any], bool]:
    def validar(valor: Any) -> bool:
        try:
            adaptador.validate_python(valor, strict=True)
        except ValidationError:
            return False
        return True

    return validar


async def _agregar(pipeline: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cursor = await get_db().incidencias_campus.aggregate(pipeline)
    return [a_json(documento) async for documento in cursor]


@router.get("/edificios", response_model=list[AnaliticaEdificio])
@limiter.limit(lambda: settings.limite_consulta_pesada)
async def por_edificio(
    request: Request,
    filtros: Annotated[FiltrosAnalitica, Query()],
    usuario: Annotated[dict, Depends(require_permiso("analitica:ver"))],
):
    alcance = filtro_alcance(usuario)
    # El periodo de este reporte se refiere a la fecha real de resolución.
    pipeline = [
        {"$match": _filtro_efectivo(
            alcance,
            filtros,
            "fecha_resolucion",
            {"estado": {"$in": ["resuelta", "cerrada"]}},
            {"fecha_resolucion": {"$type": "date"}},
        )},
        {"$project": {
            "edificio": "$ubicacion.edificio",
            "horas_invertidas": 1,
            # milisegundos → horas con decimales ($dateDiff solo cuenta cambios de hora completos)
            "horas_resolucion": {"$divide": [{"$subtract": ["$fecha_resolucion", "$fecha_creacion"]}, 3600000]},
        }},
        {"$group": {
            "_id": "$edificio",
            "total": {"$sum": 1},
            "horas_invertidas": {"$sum": "$horas_invertidas"},
            "horas_resolucion_prom": {"$avg": "$horas_resolucion"},
        }},
        {"$sort": {"horas_resolucion_prom": -1}},
        {"$project": {
            "_id": 0,
            "edificio": "$_id",
            "total": 1,
            "horas_invertidas": 1,
            "horas_resolucion_prom": {"$round": ["$horas_resolucion_prom", 1]},
        }},
    ]

    async def calcular():
        return await _agregar(pipeline)

    return await cache_analitica(
        "edificios",
        alcance,
        filtros.para_cache(),
        calcular=calcular,
        validar=_cache_compatible(_TIPO_EDIFICIOS),
    )


@router.get("/tags", response_model=list[AnaliticaTag])
@limiter.limit(lambda: settings.limite_consulta_pesada)
async def top_tags(
    request: Request,
    filtros: Annotated[FiltrosAnalitica, Query()],
    usuario: Annotated[dict, Depends(require_permiso("analitica:ver"))],
):
    alcance = filtro_alcance(usuario)
    # El periodo del ranking se refiere a la creación de la incidencia.
    pipeline = [
        {"$match": _filtro_efectivo(alcance, filtros, "fecha_creacion")},
        {"$unwind": "$tags"},
        {"$group": {"_id": "$tags", "total": {"$sum": 1}}},
        {"$sort": {"total": -1, "_id": 1}},
        {"$limit": 10},
        {"$project": {"_id": 0, "tag": "$_id", "total": 1}},
    ]

    async def calcular():
        return await _agregar(pipeline)

    return await cache_analitica(
        "tags",
        alcance,
        filtros.para_cache(),
        calcular=calcular,
        validar=_cache_compatible(_TIPO_TAGS),
    )


@router.get("/resumen", response_model=ResumenAnalitica)
@limiter.limit(lambda: settings.limite_consulta_pesada)
async def resumen(
    request: Request,
    filtros: Annotated[FiltrosAnalitica, Query()],
    usuario: Annotated[dict, Depends(require_permiso("analitica:ver"))],
):
    alcance = filtro_alcance(usuario)
    rango = _rango_fechas(filtros)
    partes_iniciales: list[dict[str, Any]] = [alcance]
    if filtros.categoria is not None:
        partes_iniciales.append({"categoria": filtros.categoria})
    if rango:
        # Cada faceta aplica después el campo temporal que le corresponde.
        partes_iniciales.append({"$or": [{"fecha_creacion": rango}, {"fecha_resolucion": rango}]})

    def condiciones(estado: str | None = None, *, critica: bool = False, resolucion: bool = False):
        resultado: list[dict[str, Any]] = []
        if estado is not None:
            resultado.append({"estado": estado})
        if critica:
            resultado.append({"prioridad": "critica"})
        if resolucion:
            resultado.extend([
                {"estado": {"$in": ["resuelta", "cerrada"]}},
                {"fecha_resolucion": {"$type": "date"}},
            ])
        if rango:
            resultado.append({"fecha_resolucion" if resolucion else "fecha_creacion": rango})
        return [{"$match": {"$and": resultado}}, {"$count": "total"}]

    pipeline = [
        {"$match": {"$and": partes_iniciales}},
        {"$facet": {
            "abiertas": condiciones("abierta"),
            "en_proceso": condiciones("en_proceso"),
            "criticas": condiciones(critica=True),
            "resueltas_periodo": condiciones(resolucion=True),
        }},
        {"$project": {
            "_id": 0,
            "abiertas": {"$ifNull": [{"$arrayElemAt": ["$abiertas.total", 0]}, 0]},
            "en_proceso": {"$ifNull": [{"$arrayElemAt": ["$en_proceso.total", 0]}, 0]},
            "criticas": {"$ifNull": [{"$arrayElemAt": ["$criticas.total", 0]}, 0]},
            "resueltas_periodo": {"$ifNull": [{"$arrayElemAt": ["$resueltas_periodo.total", 0]}, 0]},
        }},
    ]

    async def calcular() -> dict[str, Any]:
        resultados = await _agregar(pipeline)
        return resultados[0] if resultados else ResumenAnalitica(
            abiertas=0,
            en_proceso=0,
            criticas=0,
            resueltas_periodo=0,
        ).model_dump()

    return await cache_analitica(
        "resumen",
        alcance,
        filtros.para_cache(),
        calcular=calcular,
        validar=_cache_compatible(_TIPO_RESUMEN),
    )
