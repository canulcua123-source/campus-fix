"""Agregación administrativa de telemetría de IA, sin exponer eventos crudos."""

import math
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from bson.decimal128 import Decimal128

from app.schemas.analitica import FiltrosMetricasIA, MetricasIAOut


def pipeline_metricas_ia(filtros: FiltrosMetricasIA, ahora: datetime | None = None) -> list[dict[str, Any]]:
    """Pipeline acotado a 180 días y con proyección explícita libre de PII."""
    desde, hasta = filtros.intervalo_utc(ahora)
    filtro: dict[str, Any] = {"fecha": {"$gte": desde, "$lt": hasta}}
    for campo in ("categoria", "proveedor", "modelo"):
        if (valor := getattr(filtros, campo)) is not None:
            filtro[campo] = valor
    return [
        {"$match": filtro},
        {
            "$project": {
                "_id": 0,
                "fecha": 1,
                "evento": 1,
                "resultado_final": 1,
                "editado": 1,
                "modo": 1,
                "categoria": 1,
                "proveedor": 1,
                "modelo": 1,
                "compuertas_fallidas": 1,
                "latencia_ia_ms": 1,
                "duracion_toque_folio_ms": 1,
                "tokens_entrada": 1,
                "tokens_salida": 1,
                "costo_estimado_usd": 1,
                "resultado_ia": 1,
            }
        },
        {"$sort": {"fecha": 1}},
    ]


def _numero(valor: Any) -> float:
    if isinstance(valor, Decimal128):
        return float(valor.to_decimal())
    if isinstance(valor, Decimal):
        return float(valor)
    return float(valor)


def _porcentaje(numerador: int, denominador: int) -> float | None:
    return None if denominador == 0 else round(numerador * 100 / denominador, 2)


def _percentil(valores: list[float], proporcion: float) -> float | None:
    if not valores:
        return None
    ordenados = sorted(valores)
    posicion = (len(ordenados) - 1) * proporcion
    inferior = math.floor(posicion)
    superior = math.ceil(posicion)
    if inferior == superior:
        return round(ordenados[inferior], 2)
    fraccion = posicion - inferior
    return round(ordenados[inferior] + (ordenados[superior] - ordenados[inferior]) * fraccion, 2)


def _duraciones(valores: list[float]) -> dict[str, int | float | None]:
    return {
        "muestras": len(valores),
        "promedio_ms": round(sum(valores) / len(valores), 2) if valores else None,
        "p50_ms": _percentil(valores, 0.5),
        "p95_ms": _percentil(valores, 0.95),
    }


def _semana(fecha: datetime) -> date:
    local = fecha.astimezone(timezone.utc).date()
    return local - timedelta(days=local.weekday())


def construir_metricas_ia(
    documentos: list[dict[str, Any]],
    *,
    desde: datetime,
    hasta: datetime,
    reportes_con_foto: int,
    reportes_agenticos_con_foto: int,
    umbral_diario_usd: float | None,
) -> dict[str, Any]:
    """Cálculo puro y determinista, reutilizado por unitarias y por el endpoint."""
    ofertas = len(documentos)
    editadas = sum(bool(documento.get("editado")) for documento in documentos)
    finales = Counter(documento.get("resultado_final") for documento in documentos)
    latencias = [_numero(d["latencia_ia_ms"]) for d in documentos if "latencia_ia_ms" in d]
    toque_folio = [
        _numero(d["duracion_toque_folio_ms"])
        for d in documentos
        if d.get("resultado_final") == "enviado" and "duracion_toque_folio_ms" in d
    ]
    compuertas = Counter(
        compuerta
        for documento in documentos
        for compuerta in documento.get("compuertas_fallidas", [])
    )

    con_costo = [d for d in documentos if "costo_estimado_usd" in d]
    costos_diarios: dict[date, list[float]] = defaultdict(list)
    costos_proveedor: dict[str, list[float]] = defaultdict(list)
    costos_modelo: dict[str, list[float]] = defaultdict(list)
    semanas: dict[date, list[dict[str, Any]]] = defaultdict(list)
    for documento in documentos:
        fecha = documento["fecha"]
        semanas[_semana(fecha)].append(documento)
        if "costo_estimado_usd" not in documento:
            continue
        costo = _numero(documento["costo_estimado_usd"])
        costos_diarios[fecha.astimezone(timezone.utc).date()].append(costo)
        if documento.get("proveedor"):
            costos_proveedor[documento["proveedor"]].append(costo)
        if documento.get("modelo"):
            costos_modelo[documento["modelo"]].append(costo)

    diario = [
        {
            "fecha": fecha,
            "costo_estimado_usd": round(sum(costos), 8),
            "llamadas_con_costo": len(costos),
        }
        for fecha, costos in sorted(costos_diarios.items())
    ]
    dias_excedidos = [
        fila["fecha"]
        for fila in diario
        if umbral_diario_usd is not None and fila["costo_estimado_usd"] > umbral_diario_usd
    ]

    def agrupados(grupos: dict[str, list[float]]) -> list[dict[str, Any]]:
        return [
            {
                "clave": clave,
                "costo_estimado_usd": round(sum(costos), 8),
                "llamadas_con_costo": len(costos),
            }
            for clave, costos in sorted(grupos.items())
        ]

    entrada_disponible = [int(d["tokens_entrada"]) for d in documentos if "tokens_entrada" in d]
    salida_disponible = [int(d["tokens_salida"]) for d in documentos if "tokens_salida" in d]
    total_costo = round(sum(_numero(d["costo_estimado_usd"]) for d in con_costo), 8) if con_costo else None
    correccion_no_disponible = (
        "El historial actual no registra cambios de categoría o prioridad ni permite atribuirlos a un técnico."
    )

    resultado = {
        "periodo": {"desde": desde, "hasta": hasta},
        "totales": {
            "ofertas": ofertas,
            "editadas": editadas,
            "deshechas": finales["deshecho"],
            "enviadas": finales["enviado"],
            "duplicados_sumados": finales["duplicado_sumado"],
            "fallback": finales["fallback"],
        },
        "tasa_deshacer": {
            "numerador": finales["deshecho"],
            "denominador": ofertas,
            "porcentaje": _porcentaje(finales["deshecho"], ofertas),
            "disponible": True,
        },
        "tasa_edicion": {
            "numerador": editadas,
            "denominador": ofertas,
            "porcentaje": _porcentaje(editadas, ofertas),
            "disponible": True,
        },
        "correccion_tecnica_72h": {
            "numerador": 0,
            "denominador": 0,
            "porcentaje": None,
            "disponible": False,
            "motivo": correccion_no_disponible,
        },
        "cobertura_agentica": {
            "numerador": reportes_agenticos_con_foto,
            "denominador": reportes_con_foto,
            "porcentaje": _porcentaje(reportes_agenticos_con_foto, reportes_con_foto),
            "disponible": True,
        },
        "tiempo_toque_folio": _duraciones(toque_folio),
        "compuertas_fallidas": [
            {"compuerta": compuerta, "total": total}
            for compuerta, total in sorted(compuertas.items())
        ],
        "latencia_ia": _duraciones(latencias),
        "errores_ia": sum(d.get("resultado_ia") == "error" for d in documentos),
        "timeouts_ia": sum(d.get("resultado_ia") == "timeout" for d in documentos),
        "costos": {
            "costo_estimado_periodo_usd": total_costo,
            "llamadas_con_costo": len(con_costo),
            "tokens_entrada": sum(entrada_disponible) if entrada_disponible else None,
            "tokens_salida": sum(salida_disponible) if salida_disponible else None,
            "diario": diario,
            "por_proveedor": agrupados(costos_proveedor),
            "por_modelo": agrupados(costos_modelo),
            "alerta": {
                "configurada": umbral_diario_usd is not None,
                "activa": bool(dias_excedidos),
                "umbral_diario_usd": umbral_diario_usd,
                "dias_excedidos": dias_excedidos,
            },
        },
        "semanal": [
            {
                "semana": semana,
                "ofertas": len(docs),
                "deshechas": sum(d.get("resultado_final") == "deshecho" for d in docs),
                "editadas": sum(bool(d.get("editado")) for d in docs),
                "costo_estimado_usd": (
                    round(sum(_numero(d["costo_estimado_usd"]) for d in docs if "costo_estimado_usd" in d), 8)
                    if any("costo_estimado_usd" in d for d in docs)
                    else None
                ),
            }
            for semana, docs in sorted(semanas.items())
        ],
    }
    return MetricasIAOut.model_validate(resultado).model_dump(mode="json")


async def obtener_metricas_ia(
    db: Any,
    filtros: FiltrosMetricasIA,
    *,
    alcance_incidencias: dict[str, Any],
    umbral_diario_usd: float | None,
    ahora: datetime | None = None,
) -> dict[str, Any]:
    desde, hasta = filtros.intervalo_utc(ahora)
    cursor = await db.ia_eventos.aggregate(pipeline_metricas_ia(filtros, ahora))
    documentos = [documento async for documento in cursor]

    condiciones_incidencias: list[dict[str, Any]] = [
        alcance_incidencias,
        {"fecha_creacion": {"$gte": desde, "$lt": hasta}},
        {"evidencias_adjuntas.0": {"$exists": True}},
    ]
    if filtros.categoria is not None:
        condiciones_incidencias.append({"categoria": filtros.categoria})
    filtro_fotos = {"$and": condiciones_incidencias}
    reportes_con_foto = await db.incidencias_campus.count_documents(filtro_fotos)
    reportes_agenticos = await db.incidencias_campus.count_documents(
        {"$and": [*condiciones_incidencias, {"ia_sugerencia.modo": "agentico"}]}
    )
    return construir_metricas_ia(
        documentos,
        desde=desde,
        hasta=hasta,
        reportes_con_foto=reportes_con_foto,
        reportes_agenticos_con_foto=reportes_agenticos,
        umbral_diario_usd=umbral_diario_usd,
    )


__all__ = ["construir_metricas_ia", "obtener_metricas_ia", "pipeline_metricas_ia"]
