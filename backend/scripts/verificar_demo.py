"""Verifica, sin modificar datos, las incidencias demo de una base MongoDB local."""

import asyncio
import math
import os
import re
import sys
import uuid
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bson import ObjectId  # noqa: E402
from pydantic import TypeAdapter, ValidationError  # noqa: E402
from pymongo import AsyncMongoClient  # noqa: E402
from pymongo.errors import PyMongoError  # noqa: E402
from pymongo.uri_parser import parse_uri  # noqa: E402

from app.schemas.incidencia import (  # noqa: E402
    TRANSICIONES,
    DetalleEspecifico,
    IncidenciaIn,
    SeguimientoIn,
    Ubicacion,
    normalizar_tag,
)

CATEGORIAS = ("computo_redes", "infraestructura", "academico")
PRIORIDADES = ("baja", "media", "alta", "critica")
ESTADOS = ("abierta", "en_proceso", "en_espera", "resuelta", "cerrada")
TIPOS_MIME = ("image/jpeg", "image/png", "image/webp", "application/pdf")
PREFIJOS = {"computo_redes": "RED", "infraestructura": "INF", "academico": "ACA"}
UBICACIONES_LOCALES = {"localhost", "127.0.0.1", "::1"}
RE_CODIGO = re.compile(r"^INC-(\d{4})-(\d{4})-(RED|INF|ACA)-(\d{4})$")
ADAPTADOR_DETALLE = TypeAdapter(DetalleEspecifico)


@dataclass(frozen=True)
class ResultadoVerificacion:
    clave: str
    descripcion: str
    cumple: bool
    detalle: str


def _resultado(clave: str, descripcion: str, cumple: bool, detalle: str) -> ResultadoVerificacion:
    return ResultadoVerificacion(clave, descripcion, cumple, detalle)


def _es_fecha_utc(valor: object) -> bool:
    return (
        isinstance(valor, datetime)
        and valor.tzinfo is not None
        and valor.utcoffset() == timedelta(0)
    )


def _es_hora_valida(valor: object) -> bool:
    if isinstance(valor, bool) or not isinstance(valor, int | float):
        return False
    numero = float(valor)
    return math.isfinite(numero) and 0 <= numero <= 24 and math.isclose(numero * 4, round(numero * 4))


def _rutas_nulas(valor: object, ruta: str = "documento") -> list[str]:
    if valor is None:
        return [ruta]
    if isinstance(valor, dict):
        return [subruta for clave, item in valor.items() for subruta in _rutas_nulas(item, f"{ruta}.{clave}")]
    if isinstance(valor, list):
        return [subruta for indice, item in enumerate(valor) for subruta in _rutas_nulas(item, f"{ruta}[{indice}]")]
    return []


def _detalle_valido(documento: dict) -> bool:
    detalle = documento.get("detalle_especifico")
    try:
        ADAPTADOR_DETALLE.validate_python(detalle, strict=True)
    except ValidationError:
        return False
    return isinstance(detalle, dict) and documento.get("categoria") == detalle.get("categoria")


def _ubicacion_valida(documento: dict) -> bool:
    ubicacion = documento.get("ubicacion")
    try:
        Ubicacion.model_validate(ubicacion, strict=True)
    except ValidationError:
        return False
    return isinstance(ubicacion, dict) and set(ubicacion) <= {"edificio", "piso", "aula"}


def _reportante_valido(documento: dict) -> bool:
    reportante = documento.get("reportante")
    return (
        isinstance(reportante, dict)
        and set(reportante) == {"usuario_id", "nombre"}
        and isinstance(reportante.get("usuario_id"), ObjectId)
        and isinstance(reportante.get("nombre"), str)
        and bool(reportante["nombre"].strip())
    )


def _tags_validos(documento: dict) -> bool:
    tags = documento.get("tags")
    if (
        not isinstance(tags, list)
        or not tags
        or len(tags) > 15
        or not all(isinstance(tag, str) for tag in tags)
        or len(tags) != len(set(tags))
    ):
        return False
    try:
        return all(isinstance(tag, str) and normalizar_tag(tag) == tag for tag in tags)
    except ValueError:
        return False


def _evidencia_valida(evidencia: object, codigo: object, creada: object) -> bool:
    if not isinstance(evidencia, dict):
        return False
    requeridos = {
        "evidencia_id",
        "nombre_archivo",
        "tipo_mime",
        "peso_kb",
        "url_storage",
        "fecha_carga",
        "subido_por",
    }
    if set(evidencia) != requeridos:
        return False
    try:
        uuid.UUID(evidencia["evidencia_id"])
    except (AttributeError, TypeError, ValueError):
        return False
    peso = evidencia.get("peso_kb")
    ruta = evidencia.get("url_storage")
    return (
        isinstance(evidencia.get("nombre_archivo"), str)
        and bool(evidencia["nombre_archivo"].strip())
        and evidencia.get("tipo_mime") in TIPOS_MIME
        and not isinstance(peso, bool)
        and isinstance(peso, int | float)
        and 0 < peso <= 10240
        and isinstance(ruta, str)
        and isinstance(codigo, str)
        and ruta.startswith(f"evidencias/{codigo}/")
        and not ruta.startswith(("http://", "https://"))
        and _es_fecha_utc(evidencia.get("fecha_carga"))
        and evidencia.get("fecha_carga") == creada
        and isinstance(evidencia.get("subido_por"), ObjectId)
    )


def _historial_valido(documento: dict, ahora: datetime) -> bool:
    historial = documento.get("historial_seguimiento")
    creada = documento.get("fecha_creacion")
    actualizada = documento.get("fecha_actualizacion")
    if not isinstance(historial, list) or not historial or not _es_fecha_utc(creada) or not _es_fecha_utc(actualizada):
        return False
    if (
        not isinstance(historial[0], dict)
        or historial[0].get("estado_nuevo") != "abierta"
        or historial[0].get("fecha") != creada
    ):
        return False

    estado_anterior = None
    fecha_anterior = creada
    total_horas = 0.0
    fecha_resolucion_historial = None
    campos = {"fecha", "usuario_id", "estado_nuevo", "comentario", "horas"}
    for evento in historial:
        if not isinstance(evento, dict) or set(evento) != campos:
            return False
        fecha = evento.get("fecha")
        horas = evento.get("horas")
        try:
            SeguimientoIn.model_validate(
                {clave: evento[clave] for clave in ("estado_nuevo", "comentario", "horas")},
                strict=True,
            )
        except ValidationError:
            return False
        if (
            not _es_fecha_utc(fecha)
            or fecha < fecha_anterior
            or fecha > ahora
            or not isinstance(evento.get("usuario_id"), ObjectId)
            or not _es_hora_valida(horas)
        ):
            return False
        estado_nuevo = evento["estado_nuevo"]
        if estado_anterior is not None and estado_nuevo not in TRANSICIONES[estado_anterior]:
            return False
        if estado_nuevo == "resuelta" and fecha_resolucion_historial is None:
            fecha_resolucion_historial = fecha
        estado_anterior = estado_nuevo
        fecha_anterior = fecha
        total_horas += float(horas)

    resolucion = documento.get("fecha_resolucion")
    terminal = documento.get("estado") in {"resuelta", "cerrada"}
    resolucion_coherente = (
        terminal
        and _es_fecha_utc(resolucion)
        and resolucion == fecha_resolucion_historial
        and creada <= resolucion <= ahora
        and resolucion >= ahora - timedelta(days=60)
    ) or (not terminal and "fecha_resolucion" not in documento)
    horas_documento = documento.get("horas_invertidas")
    return (
        estado_anterior == documento.get("estado")
        and actualizada == historial[-1]["fecha"]
        and actualizada <= ahora
        and resolucion_coherente
        and _es_hora_valida(horas_documento)
        and math.isclose(float(horas_documento), total_horas)
    )


def _codigo_valido(documento: dict) -> bool:
    codigo = documento.get("codigo")
    creada = documento.get("fecha_creacion")
    coincidencia = RE_CODIGO.fullmatch(codigo) if isinstance(codigo, str) else None
    if coincidencia is None or not _es_fecha_utc(creada):
        return False
    anio, mes_dia, prefijo, folio = coincidencia.groups()
    return (
        anio == f"{creada:%Y}"
        and mes_dia == f"{creada:%m%d}"
        and prefijo == PREFIJOS.get(documento.get("categoria"))
        and 9000 <= int(folio) <= 9023
    )


def _documento_compatible(documento: object) -> bool:
    if not isinstance(documento, dict):
        return False
    requeridos = {
        "schema_version",
        "demo",
        "codigo",
        "titulo",
        "descripcion",
        "categoria",
        "estado",
        "prioridad",
        "ubicacion",
        "reportante",
        "detalle_especifico",
        "fecha_creacion",
        "fecha_actualizacion",
        "tags",
        "historial_seguimiento",
        "evidencias_adjuntas",
        "horas_invertidas",
    }
    if (
        not requeridos <= set(documento)
        or type(documento.get("schema_version")) is not int
        or documento.get("schema_version") != 1
        or documento.get("demo") is not True
    ):
        return False
    try:
        IncidenciaIn.model_validate(
            {clave: documento[clave] for clave in ("titulo", "descripcion", "prioridad", "ubicacion", "detalle_especifico", "tags")},
            strict=True,
        )
    except ValidationError:
        return False
    evidencias = documento.get("evidencias_adjuntas")
    return (
        documento.get("categoria") in CATEGORIAS
        and documento.get("estado") in ESTADOS
        and documento.get("prioridad") in PRIORIDADES
        and _codigo_valido(documento)
        and isinstance(evidencias, list)
        and len(evidencias) <= 10
        and all(
            _evidencia_valida(evidencia, documento.get("codigo"), documento.get("fecha_creacion"))
            for evidencia in evidencias
        )
    )


def verificar_requisitos(documentos: list[dict]) -> list[ResultadoVerificacion]:
    """Evalúa los 17 criterios T-009 sobre documentos ya cargados en memoria."""
    total = len(documentos)
    categorias = Counter(
        categoria if isinstance(categoria, str) else "<inválida>"
        for doc in documentos
        if isinstance(doc, dict)
        for categoria in [doc.get("categoria")]
    )
    conteos_categoria = [categorias[categoria] for categoria in CATEGORIAS]
    balance = (
        set(categorias) == set(CATEGORIAS)
        and all(conteos_categoria)
        and max(conteos_categoria) - min(conteos_categoria) <= 2
    )

    edificios = {
        edificio
        for doc in documentos
        if isinstance(doc, dict) and isinstance((ubicacion := doc.get("ubicacion")), dict)
        for edificio in [ubicacion.get("edificio")]
        if isinstance(edificio, str)
    }
    prioridades = {
        prioridad if isinstance(prioridad, str) else "<inválida>"
        for doc in documentos
        if isinstance(doc, dict)
        for prioridad in [doc.get("prioridad")]
    }
    estados = {
        estado if isinstance(estado, str) else "<inválido>"
        for doc in documentos
        if isinstance(doc, dict)
        for estado in [doc.get("estado")]
    }
    ahora = datetime.now(timezone.utc) + timedelta(seconds=1)

    resoluciones = [doc.get("fecha_resolucion") for doc in documentos if isinstance(doc, dict) and "fecha_resolucion" in doc]
    resoluciones_validas = all(
        _es_fecha_utc(fecha)
        and doc.get("estado") in {"resuelta", "cerrada"}
        and _es_fecha_utc(doc.get("fecha_creacion"))
        and doc["fecha_creacion"] <= fecha <= ahora
        for doc, fecha in (
            (doc, doc.get("fecha_resolucion"))
            for doc in documentos
            if isinstance(doc, dict) and "fecha_resolucion" in doc
        )
    )
    terminales_con_resolucion = all(
        doc.get("estado") not in {"resuelta", "cerrada"} or "fecha_resolucion" in doc
        for doc in documentos
        if isinstance(doc, dict)
    )

    con_evidencias = 0
    evidencias_validas = True
    for doc in documentos:
        if not isinstance(doc, dict):
            evidencias_validas = False
            continue
        evidencias = doc.get("evidencias_adjuntas")
        if not isinstance(evidencias, list) or len(evidencias) > 10:
            evidencias_validas = False
            continue
        if evidencias:
            con_evidencias += 1
        evidencias_validas = evidencias_validas and all(
            _evidencia_valida(evidencia, doc.get("codigo"), doc.get("fecha_creacion"))
            for evidencia in evidencias
        )

    ubicaciones = Counter(
        (ubicacion["edificio"], ubicacion.get("piso"), ubicacion["aula"])
        for doc in documentos
        if isinstance(doc, dict) and isinstance((ubicacion := doc.get("ubicacion")), dict)
        and isinstance(ubicacion.get("edificio"), str)
        and isinstance(ubicacion.get("piso"), int)
        and isinstance(ubicacion.get("aula"), str)
    )
    ubicacion_recurrente, maximo_recurrencia = (ubicaciones.most_common(1)[0] if ubicaciones else (None, 0))
    nulos = [
        ruta
        for indice, documento in enumerate(documentos)
        for ruta in _rutas_nulas(documento, f"documentos[{indice}]")
    ]
    codigos = [doc.get("codigo") for doc in documentos if isinstance(doc, dict) and isinstance(doc.get("codigo"), str)]
    documentos_dict = sum(isinstance(doc, dict) for doc in documentos)
    detalles_validos = sum(_detalle_valido(doc) for doc in documentos if isinstance(doc, dict))
    tags_validos = sum(_tags_validos(doc) for doc in documentos if isinstance(doc, dict))
    historiales_presentes = sum(
        isinstance(doc.get("historial_seguimiento"), list) and bool(doc["historial_seguimiento"])
        for doc in documentos
        if isinstance(doc, dict)
    )
    reportantes_validos = sum(_reportante_valido(doc) for doc in documentos if isinstance(doc, dict))
    ubicaciones_validas = sum(_ubicacion_valida(doc) for doc in documentos if isinstance(doc, dict))
    historiales_validos = sum(_historial_valido(doc, ahora) for doc in documentos if isinstance(doc, dict))
    documentos_compatibles = sum(_documento_compatible(doc) for doc in documentos)

    return [
        _resultado("cantidad", "Cantidad de incidencias", 20 <= total <= 30, f"{total} (esperado: 20 a 30)"),
        _resultado(
            "balance_categorias",
            "Balance entre categorías",
            balance,
            ", ".join(f"{categoria}={categorias[categoria]}" for categoria in CATEGORIAS),
        ),
        _resultado("edificios", "Edificios distintos", len(edificios) >= 4, f"{len(edificios)} (mínimo: 4)"),
        _resultado(
            "prioridades",
            "Prioridades presentes",
            prioridades == set(PRIORIDADES),
            f"{len(prioridades & set(PRIORIDADES))} de {len(PRIORIDADES)}",
        ),
        _resultado(
            "estados", "Estados presentes", estados == set(ESTADOS), f"{len(estados & set(ESTADOS))} de {len(ESTADOS)}"
        ),
        _resultado(
            "resoluciones",
            "Incidencias con resolución BSON/UTC",
            len(resoluciones) >= 8 and resoluciones_validas and terminales_con_resolucion,
            f"{len(resoluciones)} (mínimo: 8)",
        ),
        _resultado(
            "evidencias",
            "Incidencias con evidencias válidas",
            con_evidencias >= 15 and evidencias_validas,
            f"{con_evidencias} (mínimo: 15)",
        ),
        _resultado(
            "aula_recurrente",
            "Aula recurrente",
            maximo_recurrencia >= 3,
            (
                f"{ubicacion_recurrente[0]} / piso {ubicacion_recurrente[1]} / aula {ubicacion_recurrente[2]} "
                f"({maximo_recurrencia} incidencias)"
                if ubicacion_recurrente
                else "ninguna ubicación disponible"
            ),
        ),
        _resultado(
            "polimorfismo",
            "Detalles polimórficos válidos",
            total > 0 and detalles_validos == total,
            f"{detalles_validos} de {total} coinciden con su categoría",
        ),
        _resultado(
            "sin_nulos",
            "Ausencia de null de relleno",
            not nulos,
            "sin valores null" if not nulos else f"primer null: {nulos[0]}",
        ),
        _resultado(
            "tags",
            "Tags presentes y válidos",
            total > 0 and tags_validos == total,
            f"{tags_validos} de {total}",
        ),
        _resultado(
            "historial",
            "Historial de seguimiento presente",
            total > 0 and historiales_presentes == total,
            f"{historiales_presentes} de {total}",
        ),
        _resultado(
            "reportante",
            "Reportante válido",
            total > 0 and reportantes_validos == total,
            f"{reportantes_validos} de {total} con referencia ObjectId y nombre",
        ),
        _resultado(
            "ubicacion",
            "Ubicación válida",
            total > 0 and ubicaciones_validas == total,
            f"{ubicaciones_validas} de {total} compatibles",
        ),
        _resultado(
            "consistencia_temporal",
            "Consistencia de fechas, historial y horas",
            total > 0 and historiales_validos == total,
            f"{historiales_validos} de {total} coherentes",
        ),
        _resultado(
            "codigos_unicos",
            "Códigos únicos",
            len(codigos) == total and len(codigos) == len(set(codigos)),
            f"{len(set(codigos))} únicos de {total}",
        ),
        _resultado(
            "esquemas",
            "Valores compatibles con esquemas vigentes",
            total > 0 and documentos_dict == total and documentos_compatibles == total,
            f"{documentos_compatibles} de {total} compatibles con Pydantic, catálogos y formato demo",
        ),
    ]


def codigo_salida(resultados: list[ResultadoVerificacion]) -> int:
    return 0 if resultados and all(resultado.cumple for resultado in resultados) else 1


def imprimir_resultados(resultados: list[ResultadoVerificacion]) -> None:
    reconfigurar = getattr(sys.stdout, "reconfigure", None)
    if callable(reconfigurar):
        reconfigurar(encoding="utf-8", errors="replace")
    print("=== VERIFICACIÓN DE DATOS DEMO UTM DESK ===")
    print()
    for resultado in resultados:
        marca = "✔" if resultado.cumple else "✘"
        print(f"{marca} {resultado.descripcion}: {resultado.detalle}")
    print()
    if codigo_salida(resultados) == 0:
        print("RESULTADO: TODOS LOS REQUISITOS CUMPLIDOS")
    else:
        fallidos = sum(not resultado.cumple for resultado in resultados)
        print(f"RESULTADO: {fallidos} REQUISITO(S) INCUMPLIDO(S)")


def _configuracion_local() -> tuple[str, str]:
    uri = os.environ.get("MONGODB_DEMO_URI", "mongodb://localhost:27017")
    nombre_bd = os.environ.get("MONGODB_DEMO_DB", "utm_desk")
    if not uri.lower().startswith("mongodb://"):
        raise ValueError("solo se admite una URI mongodb:// local")
    configuracion = parse_uri(uri)
    hosts = {host.lower().rstrip(".") for host, _puerto in configuracion["nodelist"]}
    if not hosts or not hosts <= UBICACIONES_LOCALES:
        raise ValueError("el verificador solo admite MongoDB local")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", nombre_bd) or nombre_bd in {"admin", "config", "local"}:
        raise ValueError("nombre de base local no permitido")
    return uri, nombre_bd


async def obtener_documentos_demo() -> list[dict]:
    """Lee únicamente ``demo: true`` desde MongoDB local; no realiza escrituras."""
    uri, nombre_bd = _configuracion_local()
    cliente = AsyncMongoClient(uri, serverSelectionTimeoutMS=3000, tz_aware=True)
    try:
        await cliente.admin.command("ping")
        cursor = cliente[nombre_bd].incidencias_campus.find({"demo": True})
        return [documento async for documento in cursor]
    finally:
        await cliente.close()


def main() -> int:
    try:
        documentos = asyncio.run(obtener_documentos_demo())
    except (OSError, PyMongoError, ValueError):
        print(
            "ERROR: no fue posible consultar MongoDB local. "
            "Inicia el servicio autorizado o revisa MONGODB_DEMO_URI/MONGODB_DEMO_DB."
        )
        return 2
    resultados = verificar_requisitos(documentos)
    imprimir_resultados(resultados)
    return codigo_salida(resultados)


if __name__ == "__main__":
    sys.exit(main())
