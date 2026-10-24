from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import TypeAdapter, ValidationError

from app.core.cache import cache_analitica
from app.core.config import settings
from app.core.db import get_db
from app.core.limiter import limiter
from app.core.security import filtro_alcance, require_permiso
from app.core.serial import a_json
from app.schemas.analitica import (
    AnaliticaEdificio,
    AnaliticaTag,
    AulaCronica,
    CargaTecnico,
    FiltrosAnalitica,
    ResumenAnalitica,
    TendenciaMensual,
)


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
_TIPO_AULAS_CRONICAS = TypeAdapter(list[AulaCronica])
_TIPO_CARGA_TECNICOS = TypeAdapter(list[CargaTecnico])
_TIPO_TENDENCIA = TypeAdapter(list[TendenciaMensual])
_ESTADOS_ACTIVOS = ["abierta", "en_proceso", "en_espera"]
_RESPUESTAS_ANALITICA = {
    400: {"description": "Filtros inválidos"},
    401: {"description": "No autenticado"},
    403: {"description": "Falta el permiso analitica:ver"},
    429: {"description": "Límite de consultas excedido"},
}


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


def _pipeline_aulas_cronicas(
    alcance: dict[str, Any],
    filtros: FiltrosAnalitica,
    ahora: datetime,
) -> list[dict[str, Any]]:
    """Construye la ventana UTC cerrada de 30 días, intersectada con los filtros."""
    ventana = {"$gte": ahora - timedelta(days=30), "$lte": ahora}
    return [
        {"$match": _filtro_efectivo(
            alcance,
            filtros,
            "fecha_creacion",
            {"fecha_creacion": {"$type": "date"}},
            {"fecha_creacion": ventana},
        )},
        {"$project": {
            "_id": 0,
            "edificio": "$ubicacion.edificio",
            "piso": "$ubicacion.piso",
            "aula": "$ubicacion.aula",
        }},
        {"$group": {
            "_id": {
                "edificio": "$edificio",
                "piso": "$piso",
                "aula": "$aula",
            },
            "total": {"$sum": 1},
        }},
        {"$match": {"total": {"$gte": 3}}},
        {"$sort": {"total": -1, "_id.edificio": 1, "_id.piso": 1, "_id.aula": 1}},
        {"$project": {
            "_id": 0,
            "edificio": "$_id.edificio",
            "piso": {
                "$cond": [
                    {"$ne": ["$_id.piso", None]},
                    "$_id.piso",
                    "$$REMOVE",
                ],
            },
            "aula": "$_id.aula",
            "total": 1,
        }},
    ]


def _pipeline_carga_tecnicos(
    alcance: dict[str, Any],
    filtros: FiltrosAnalitica,
) -> list[dict[str, Any]]:
    return [
        {"$match": _filtro_efectivo(
            alcance,
            filtros,
            "fecha_creacion",
            {"estado": {"$in": _ESTADOS_ACTIVOS}},
            {"tecnico_asignado.usuario_id": {"$type": "objectId"}},
        )},
        {"$group": {
            "_id": "$tecnico_asignado.usuario_id",
            "incidencias_activas": {"$sum": 1},
            "horas_acumuladas": {"$sum": "$horas_invertidas"},
        }},
        {"$sort": {"incidencias_activas": -1, "horas_acumuladas": -1, "_id": 1}},
        {"$project": {
            "_id": 0,
            "tecnico_id": {"$toString": "$_id"},
            "incidencias_activas": 1,
            "horas_acumuladas": 1,
        }},
    ]


def _pipeline_tendencia(
    alcance: dict[str, Any],
    filtros: FiltrosAnalitica,
) -> list[dict[str, Any]]:
    return [
        {"$match": _filtro_efectivo(
            alcance,
            filtros,
            "fecha_creacion",
            {"fecha_creacion": {"$type": "date"}},
        )},
        {"$group": {
            "_id": {
                "anio": {
                    "$year": {
                        "date": "$fecha_creacion",
                        "timezone": "UTC",
                    },
                },
                "mes": {
                    "$month": {
                        "date": "$fecha_creacion",
                        "timezone": "UTC",
                    },
                },
                "categoria": "$categoria",
            },
            "total": {"$sum": 1},
        }},
        {"$sort": {"_id.anio": 1, "_id.mes": 1, "_id.categoria": 1}},
        {"$project": {
            "_id": 0,
            "periodo": {
                "$concat": [
                    {"$toString": "$_id.anio"},
                    "-",
                    {
                        "$cond": [
                            {"$lt": ["$_id.mes", 10]},
                            {"$concat": ["0", {"$toString": "$_id.mes"}]},
                            {"$toString": "$_id.mes"},
                        ],
                    },
                ],
            },
            "categoria": "$_id.categoria",
            "total": 1,
        }},
    ]


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


@router.get(
    "/aulas-cronicas",
    response_model=list[AulaCronica],
    response_model_exclude_none=True,
    summary="Aulas con al menos tres incidencias en los últimos 30 días",
    responses=_RESPUESTAS_ANALITICA,
)
@limiter.limit(lambda: settings.limite_consulta_pesada)
async def aulas_cronicas(
    request: Request,
    filtros: Annotated[FiltrosAnalitica, Query()],
    usuario: Annotated[dict, Depends(require_permiso("analitica:ver"))],
):
    alcance = filtro_alcance(usuario)
    pipeline = _pipeline_aulas_cronicas(
        alcance,
        filtros,
        datetime.now(timezone.utc),
    )

    async def calcular():
        return await _agregar(pipeline)

    filtros_cache = {
        **filtros.para_cache(),
        "campo_fecha": "fecha_creacion",
        "ventana": "ultimos_30_dias_utc",
    }
    return await cache_analitica(
        "aulas-cronicas",
        alcance,
        filtros_cache,
        ttl=300,
        calcular=calcular,
        validar=_cache_compatible(_TIPO_AULAS_CRONICAS),
    )


@router.get(
    "/carga-tecnicos",
    response_model=list[CargaTecnico],
    summary="Carga activa y horas acumuladas por técnico",
    responses=_RESPUESTAS_ANALITICA,
)
@limiter.limit(lambda: settings.limite_consulta_pesada)
async def carga_tecnicos(
    request: Request,
    filtros: Annotated[FiltrosAnalitica, Query()],
    usuario: Annotated[dict, Depends(require_permiso("analitica:ver"))],
):
    alcance = filtro_alcance(usuario)
    pipeline = _pipeline_carga_tecnicos(alcance, filtros)

    async def calcular():
        return await _agregar(pipeline)

    filtros_cache = {
        **filtros.para_cache(),
        "campo_fecha": "fecha_creacion",
        "estados": _ESTADOS_ACTIVOS,
    }
    return await cache_analitica(
        "carga-tecnicos",
        alcance,
        filtros_cache,
        ttl=300,
        calcular=calcular,
        validar=_cache_compatible(_TIPO_CARGA_TECNICOS),
    )


@router.get(
    "/tendencia",
    response_model=list[TendenciaMensual],
    summary="Tendencia mensual de incidencias por categoría",
    responses=_RESPUESTAS_ANALITICA,
)
@limiter.limit(lambda: settings.limite_consulta_pesada)
async def tendencia(
    request: Request,
    filtros: Annotated[FiltrosAnalitica, Query()],
    usuario: Annotated[dict, Depends(require_permiso("analitica:ver"))],
):
    alcance = filtro_alcance(usuario)
    pipeline = _pipeline_tendencia(alcance, filtros)

    async def calcular():
        return await _agregar(pipeline)

    filtros_cache = {
        **filtros.para_cache(),
        "campo_fecha": "fecha_creacion",
        "agrupacion": "mes_categoria_utc",
    }
    return await cache_analitica(
        "tendencia",
        alcance,
        filtros_cache,
        ttl=300,
        calcular=calcular,
        validar=_cache_compatible(_TIPO_TENDENCIA),
    )
