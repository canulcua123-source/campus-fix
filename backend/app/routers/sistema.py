"""Centro de control del superadmin: salud de dependencias y resumen operativo con alertas accionables."""

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

from bson import ObjectId
from fastapi import APIRouter, Depends, Request
from pymongo.errors import PyMongoError
from redis.exceptions import RedisError

from app.core.config import settings
from app.core.db import get_db, get_redis
from app.core.limiter import limiter
from app.core.security import PERMISO_SUPERADMIN, filtro_alcance, require_permiso
from app.routers.analitica import _ESTADOS_ACTIVOS, _pipeline_carga_tecnicos
from app.schemas.analitica import FiltrosAnalitica
from app.schemas.sistema import ComponenteSalud, ResumenSistema, SaludIA, SaludSistema
from app.services.config_ia import ConfiguracionIANoDisponible, obtener_config_ia

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/sistema", tags=["sistema"])

_INICIO = time.monotonic()
# Umbrales de alerta (alineados con el indicador de SLA del frontend: lib/bandeja.ts → vencida ≥ 24 h).
HORAS_CRITICA_SIN_ASIGNAR = 4
HORAS_VENCIDA = 24
CARGA_ALTA_TECNICO = 8
PORCENTAJE_ALERTA_CUPO_IA = 80
LATENCIA_LENTA_MS = 500
_RESPUESTAS = {401: {"description": "No autenticado"}, 403: {"description": f"Falta el permiso {PERMISO_SUPERADMIN}"}}


def _clave_cupo_global(ahora: datetime) -> str:
    # Misma clave que routers/ia.py::_claves_cupo.
    return f"ia:uso:global:{ahora:%Y-%m-%d}"


def _por_latencia(latencia_ms: float) -> str:
    return "advertencia" if latencia_ms >= LATENCIA_LENTA_MS else "ok"


async def _salud_mongo() -> ComponenteSalud:
    inicio = time.perf_counter()
    try:
        await get_db().command("ping")
    except PyMongoError:
        logger.warning("MongoDB no responde al ping", exc_info=True)
        return ComponenteSalud(estado="error", detalle="MongoDB no responde")
    latencia = round((time.perf_counter() - inicio) * 1000, 1)
    estado = _por_latencia(latencia)
    return ComponenteSalud(
        estado=estado, detalle="Responde" if estado == "ok" else "Responde lento", latencia_ms=latencia
    )


async def _salud_redis() -> ComponenteSalud:
    inicio = time.perf_counter()
    try:
        await get_redis().ping()
    except (RedisError, OSError):
        logger.warning("Redis no responde al ping", exc_info=True)
        return ComponenteSalud(estado="error", detalle="Redis no responde: caché y cupos sin servicio")
    latencia = round((time.perf_counter() - inicio) * 1000, 1)
    estado = _por_latencia(latencia)
    return ComponenteSalud(
        estado=estado, detalle="Responde" if estado == "ok" else "Responde lento", latencia_ms=latencia
    )


def _salud_almacenamiento() -> ComponenteSalud:
    # Sin llamadas al proveedor: solo si las credenciales están configuradas (nunca se exponen).
    configurado = bool(
        settings.r2_access_key_id
        and settings.r2_secret_access_key
        and settings.r2_bucket
        and (settings.r2_account_id or settings.storage_endpoint)
    )
    if configurado:
        return ComponenteSalud(estado="ok", detalle="Credenciales configuradas")
    return ComponenteSalud(estado="error", detalle="Sin configurar: no se pueden subir evidencias")


async def _salud_ia(ahora: datetime) -> SaludIA:
    modelo = settings.gemini_modelo if settings.ia_proveedor == "gemini" else settings.ia_modelo
    clave = settings.gemini_api_key if settings.ia_proveedor == "gemini" else settings.anthropic_api_key
    base = {"proveedor": settings.ia_proveedor, "modelo": modelo}
    try:
        config = await obtener_config_ia()
    except ConfiguracionIANoDisponible:
        return SaludIA(estado="error", detalle="Configuración de IA no disponible", habilitada=False, **base)
    usados: int | None = None
    try:
        valor = await get_redis().get(_clave_cupo_global(ahora))
        usados = int(valor) if valor is not None else 0
    except (RedisError, OSError, ValueError):
        logger.warning("No se pudo leer el cupo global de IA", exc_info=True)
    limite = config.limite_diario_global
    porcentaje = round(usados * 100 / limite, 1) if usados is not None else None
    if not config.habilitada:
        estado, detalle = "advertencia", "Deshabilitada desde Configuración"
    elif not clave:
        estado, detalle = "error", "Falta la clave del proveedor"
    elif porcentaje is not None and porcentaje >= 100:
        estado, detalle = "error", "Cupo diario agotado"
    elif porcentaje is not None and porcentaje >= PORCENTAJE_ALERTA_CUPO_IA:
        estado, detalle = "advertencia", "Cupo diario por agotarse"
    else:
        estado, detalle = "ok", "Disponible"
    return SaludIA(
        estado=estado,
        detalle=detalle,
        habilitada=config.habilitada,
        usados_hoy=usados,
        limite_diario=limite,
        porcentaje_cupo=porcentaje,
        **base,
    )


@router.get("/salud", response_model=SaludSistema, response_model_exclude_none=True, responses=_RESPUESTAS)
async def salud(request: Request, _: Annotated[dict, Depends(require_permiso(PERMISO_SUPERADMIN))]):
    ahora = datetime.now(timezone.utc)
    mongo, redis = await _salud_mongo(), await _salud_redis()
    componentes = [mongo, redis, _salud_almacenamiento(), await _salud_ia(ahora)]
    if mongo.estado == "error":
        global_ = "caido"
    elif any(c.estado != "ok" for c in componentes):
        global_ = "degradado"
    else:
        global_ = "ok"
    return SaludSistema(
        estado=global_,
        version=request.app.version,
        uptime_segundos=int(time.monotonic() - _INICIO),
        fecha=ahora.isoformat(),
        mongo=componentes[0],
        redis=componentes[1],
        almacenamiento=componentes[2],
        ia=componentes[3],
    )


def _conteo(condicion: dict[str, Any]) -> list[dict[str, Any]]:
    return [{"$match": condicion}, {"$count": "total"}]


def _top(campo: str, desde: datetime) -> list[dict[str, Any]]:
    return [
        {"$match": {"fecha_creacion": {"$gte": desde}}},
        {"$group": {"_id": f"${campo}", "total": {"$sum": 1}}},
        {"$match": {"_id": {"$type": "string"}}},
        {"$sort": {"total": -1, "_id": 1}},
        {"$limit": 5},
        {"$project": {"_id": 0, "clave": "$_id", "total": 1}},
    ]


def _pipeline_resumen(alcance: dict[str, Any], ahora: datetime) -> list[dict[str, Any]]:
    activas = {"estado": {"$in": _ESTADOS_ACTIVOS}}
    sin_asignar = {"tecnico_asignado.usuario_id": {"$exists": False}}
    resuelta = {"estado": {"$in": ["resuelta", "cerrada"]}, "fecha_resolucion": {"$type": "date"}}
    inicio_dia = ahora.replace(hour=0, minute=0, second=0, microsecond=0)
    hace_30 = ahora - timedelta(days=30)
    total = lambda faceta: {"$ifNull": [{"$arrayElemAt": [f"${faceta}.total", 0]}, 0]}  # noqa: E731
    return [
        {"$match": alcance},
        {
            "$facet": {
                "abiertas": _conteo(activas),
                "criticas_sin_asignar": _conteo({**activas, **sin_asignar, "prioridad": "critica"}),
                "criticas_atrasadas": _conteo(
                    {
                        **activas,
                        **sin_asignar,
                        "prioridad": "critica",
                        "fecha_creacion": {"$lt": ahora - timedelta(hours=HORAS_CRITICA_SIN_ASIGNAR)},
                    }
                ),
                "vencidas": _conteo({**activas, "fecha_creacion": {"$lt": ahora - timedelta(hours=HORAS_VENCIDA)}}),
                "resueltas_hoy": _conteo({**resuelta, "fecha_resolucion": {"$gte": inicio_dia}}),
                "resueltas_semana": _conteo({**resuelta, "fecha_resolucion": {"$gte": ahora - timedelta(days=7)}}),
                "promedio": [
                    {"$match": {**resuelta, "fecha_resolucion": {"$gte": hace_30}}},
                    {
                        "$group": {
                            "_id": None,
                            # Datos con reloj desfasado (resolución antes de la creación) cuentan como 0.
                            "horas": {
                                "$avg": {
                                    "$max": [
                                        0,
                                        {
                                            "$dateDiff": {
                                                "startDate": "$fecha_creacion",
                                                "endDate": "$fecha_resolucion",
                                                "unit": "minute",
                                            }
                                        },
                                    ]
                                }
                            },
                        }
                    },
                ],
                "top_edificios": _top("ubicacion.edificio", hace_30),
                "top_categorias": _top("categoria", hace_30),
            }
        },
        {
            "$project": {
                "abiertas": total("abiertas"),
                "criticas_sin_asignar": total("criticas_sin_asignar"),
                "criticas_atrasadas": total("criticas_atrasadas"),
                "vencidas": total("vencidas"),
                "resueltas_hoy": total("resueltas_hoy"),
                "resueltas_semana": total("resueltas_semana"),
                "minutos_prom": {"$arrayElemAt": ["$promedio.horas", 0]},
                "top_edificios": 1,
                "top_categorias": 1,
            }
        },
    ]


async def _carga_con_nombres(alcance: dict[str, Any]) -> list[dict[str, Any]]:
    cursor = await get_db().incidencias_campus.aggregate(_pipeline_carga_tecnicos(alcance, FiltrosAnalitica()))
    carga = [doc async for doc in cursor][:10]
    ids = [ObjectId(c["tecnico_id"]) for c in carga]
    nombres = {str(u["_id"]): u["nombre"] async for u in get_db().usuarios.find({"_id": {"$in": ids}}, {"nombre": 1})}
    return [{**c, "nombre": nombres.get(c["tecnico_id"], "Técnico no encontrado")} for c in carga]


def _alertas(datos: dict[str, Any], carga: list[dict[str, Any]], ia: SaludIA) -> list[dict[str, Any]]:
    alertas: list[dict[str, Any]] = []
    if datos["criticas_atrasadas"]:
        alertas.append(
            {
                "tipo": "criticas_sin_asignar",
                "severidad": "critica",
                "titulo": "Críticas sin asignar",
                "detalle": f"Llevan más de {HORAS_CRITICA_SIN_ASIGNAR} h sin técnico asignado",
                "total": datos["criticas_atrasadas"],
                "enlace": "/tablero",
            }
        )
    if datos["vencidas"]:
        alertas.append(
            {
                "tipo": "vencidas",
                "severidad": "advertencia",
                "titulo": "Incidencias vencidas",
                "detalle": f"Activas desde hace más de {HORAS_VENCIDA} h",
                "total": datos["vencidas"],
                "enlace": "/incidencias",
            }
        )
    saturados = [c for c in carga if c["incidencias_activas"] >= CARGA_ALTA_TECNICO]
    if saturados:
        alertas.append(
            {
                "tipo": "carga_tecnicos",
                "severidad": "advertencia",
                "titulo": "Técnicos con carga alta",
                "detalle": f"Con {CARGA_ALTA_TECNICO} o más incidencias activas",
                "total": len(saturados),
                "enlace": "/tecnicos",
            }
        )
    if ia.porcentaje_cupo is not None and ia.porcentaje_cupo >= PORCENTAJE_ALERTA_CUPO_IA:
        alertas.append(
            {
                "tipo": "cupo_ia",
                "severidad": "critica" if ia.porcentaje_cupo >= 100 else "advertencia",
                "titulo": "Cupo diario de IA",
                "detalle": f"{ia.usados_hoy} de {ia.limite_diario} análisis usados hoy",
                "total": ia.usados_hoy or 0,
                "enlace": "/admin/configuracion",
            }
        )
    return alertas


@router.get("/resumen", response_model=ResumenSistema, response_model_exclude_none=True, responses=_RESPUESTAS)
@limiter.limit(lambda: settings.limite_consulta_pesada)
async def resumen(request: Request, usuario: Annotated[dict, Depends(require_permiso(PERMISO_SUPERADMIN))]):
    ahora = datetime.now(timezone.utc)
    alcance = filtro_alcance(usuario)
    cursor = await get_db().incidencias_campus.aggregate(_pipeline_resumen(alcance, ahora))
    datos = (await cursor.to_list(1))[0]
    carga = await _carga_con_nombres(alcance)
    minutos = datos.get("minutos_prom")
    return {
        "kpis": {
            "abiertas": datos["abiertas"],
            "criticas_sin_asignar": datos["criticas_sin_asignar"],
            "vencidas": datos["vencidas"],
            "resueltas_hoy": datos["resueltas_hoy"],
            "resueltas_semana": datos["resueltas_semana"],
            "horas_resolucion_prom": round(minutos / 60, 1) if minutos is not None else None,
        },
        "alertas": _alertas(datos, carga, await _salud_ia(ahora)),
        "top_edificios": datos["top_edificios"],
        "top_categorias": datos["top_categorias"],
        "carga_tecnicos": carga,
    }
