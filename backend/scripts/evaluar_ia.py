"""Evaluacion reproducible de proveedores de vision sobre el set autorizado.

El modulo evita importar la configuracion de produccion hasta que el manifiesto
ha sido validado. Asi, las metricas puras y el modo de validacion no requieren
credenciales ni servicios externos.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import math
import statistics
import sys
import time
from collections import Counter
from collections.abc import Awaitable, Callable, Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import ValidationError


RAIZ_BACKEND = Path(__file__).resolve().parents[1]
if str(RAIZ_BACKEND) not in sys.path:
    sys.path.insert(0, str(RAIZ_BACKEND))

CATEGORIAS = ("computo_redes", "infraestructura", "academico", "no_determinada")
COLUMNA_INVALIDA = "respuesta_invalida"
GRUPOS_ESPERADOS = {
    "computo": 10,
    "infraestructura": 10,
    "academico": 8,
    "no_incidencia": 6,
    "dificil": 6,
    "adversaria": 4,
}
BINS_CONFIANZA = ((0.0, 0.5), (0.5, 0.8), (0.8, 1.0))
PIPELINE_CLIENTE = "reportar-browser-image-compression-v1"
MAX_BYTES_PIPELINE = 1_500_000
MAX_LADO_PIPELINE = 1568
MANIFIESTO_PREDETERMINADO = RAIZ_BACKEND / "tests" / "eval_ia" / "etiquetas.jsonl"


class ErrorEvaluacion(Exception):
    """Error esperado que impide iniciar o completar una evaluacion."""


class ManifiestoInvalido(ErrorEvaluacion):
    pass


class EtiquetadoIncompleto(ErrorEvaluacion):
    pass


class ProveedorNoDisponible(ErrorEvaluacion):
    pass


class CredencialesNoDisponibles(ErrorEvaluacion):
    pass


@dataclass(frozen=True)
class Prediccion:
    imagen_id: str
    repeticion: int
    esperada: str
    predicha: str
    confianza: float | None
    grupo: str | None = None
    incidencia_valida_esperada: bool | None = None
    incidencia_valida_predicha: bool | None = None
    prioridad_esperada: str | None = None
    prioridad_predicha: str | None = None
    accion_esperada: str | None = None
    accion_predicha: str | None = None
    latencia_total_ms: float | None = None
    latencia_proveedor_ms: float | None = None
    tokens_entrada: int | None = None
    tokens_salida: int | None = None


@dataclass(frozen=True)
class Fallo:
    imagen_id: str
    repeticion: int
    tipo: str


@dataclass(frozen=True)
class RespuestaProveedor:
    analisis: Mapping[str, Any]
    tokens_entrada: int | None = None
    tokens_salida: int | None = None
    latencia_proveedor_ms: float | None = None


def _es_numero(valor: Any) -> bool:
    return isinstance(valor, (int, float)) and not isinstance(valor, bool) and math.isfinite(valor)


def percentil_rango_mas_cercano(valores: Sequence[float], porcentaje: float) -> float | None:
    """Percentil determinista: elemento ceil(p*n), con p en [0, 1]."""

    if not valores:
        return None
    if not 0 <= porcentaje <= 1:
        raise ValueError("El percentil debe estar entre 0 y 1")
    ordenados = sorted(float(v) for v in valores)
    indice = max(0, math.ceil(porcentaje * len(ordenados)) - 1)
    return ordenados[indice]


def matriz_confusion(predicciones: Sequence[Prediccion]) -> dict[str, dict[str, int]]:
    columnas = (*CATEGORIAS, COLUMNA_INVALIDA)
    matriz = {esperada: {predicha: 0 for predicha in columnas} for esperada in CATEGORIAS}
    for prediccion in predicciones:
        if prediccion.esperada not in CATEGORIAS:
            raise ValueError(f"Categoria esperada desconocida: {prediccion.esperada}")
        columna = prediccion.predicha if prediccion.predicha in CATEGORIAS else COLUMNA_INVALIDA
        matriz[prediccion.esperada][columna] += 1
    return matriz


def exactitud_por_categoria(predicciones: Sequence[Prediccion]) -> dict[str, dict[str, float | int]]:
    resultado: dict[str, dict[str, float | int]] = {}
    for categoria in CATEGORIAS:
        filas = [p for p in predicciones if p.esperada == categoria]
        aciertos = sum(p.predicha == categoria for p in filas)
        resultado[categoria] = {
            "aciertos": aciertos,
            "total": len(filas),
            "proporcion": aciertos / len(filas) if filas else 0.0,
        }
    return resultado


def metricas_clases(predicciones: Sequence[Prediccion]) -> dict[str, dict[str, float | int]]:
    resultado: dict[str, dict[str, float | int]] = {}
    for categoria in CATEGORIAS:
        vp = sum(p.esperada == categoria and p.predicha == categoria for p in predicciones)
        fp = sum(p.esperada != categoria and p.predicha == categoria for p in predicciones)
        fn = sum(p.esperada == categoria and p.predicha != categoria for p in predicciones)
        precision = vp / (vp + fp) if vp + fp else 0.0
        recall = vp / (vp + fn) if vp + fn else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        resultado[categoria] = {
            "vp": vp,
            "fp": fp,
            "fn": fn,
            "precision": precision,
            "recall": recall,
            "f1": f1,
        }
    return resultado


def calibracion(predicciones: Sequence[Prediccion]) -> dict[str, Any]:
    validas: list[tuple[float, int]] = []
    ausentes = 0
    for prediccion in predicciones:
        confianza = prediccion.confianza
        if confianza is None:
            ausentes += 1
            continue
        if not _es_numero(confianza) or not 0 <= confianza <= 1:
            raise ValueError("La confianza debe estar entre 0 y 1")
        validas.append((float(confianza), int(prediccion.esperada == prediccion.predicha)))

    cubetas: list[dict[str, Any]] = []
    ece = 0.0
    for inicio, fin in BINS_CONFIANZA:
        elementos = [x for x in validas if inicio <= x[0] < fin or (fin == 1.0 and x[0] == 1.0)]
        exactitud = sum(x[1] for x in elementos) / len(elementos) if elementos else None
        confianza_media = sum(x[0] for x in elementos) / len(elementos) if elementos else None
        if elementos and validas:
            ece += len(elementos) / len(validas) * abs(exactitud - confianza_media)
        cubetas.append(
            {
                "limite_inferior": inicio,
                "limite_superior": fin,
                "incluye_superior": fin == 1.0,
                "cantidad": len(elementos),
                "exactitud": exactitud,
                "confianza_media": confianza_media,
            }
        )
    brier = sum((confianza - acierto) ** 2 for confianza, acierto in validas) / len(validas) if validas else None
    return {"cubetas": cubetas, "ece": ece if validas else None, "brier": brier, "confianza_ausente": ausentes}


def calcular_costo(predicciones: Sequence[Prediccion], tarifa: Mapping[str, Any] | None) -> dict[str, Any]:
    if tarifa is None:
        return {"estado": "no_disponible", "motivo": "No se proporciono una tarifa versionada"}
    if not predicciones:
        return {"estado": "no_disponible", "motivo": "No hay respuestas evaluables"}
    requeridos = ("usd_millon_tokens_entrada", "usd_millon_tokens_salida", "fuente", "fecha")
    if any(campo not in tarifa for campo in requeridos):
        raise ValueError("La tarifa requiere precios de entrada/salida, fuente y fecha")
    con_uso = [p for p in predicciones if p.tokens_entrada is not None and p.tokens_salida is not None]
    if len(con_uso) != len(predicciones):
        return {
            "estado": "no_disponible",
            "motivo": "El proveedor no devolvio uso suficiente para todas las respuestas",
            "respuestas_con_uso": len(con_uso),
            "respuestas_totales": len(predicciones),
        }
    entrada = sum(p.tokens_entrada or 0 for p in con_uso)
    salida = sum(p.tokens_salida or 0 for p in con_uso)
    total = entrada * float(tarifa["usd_millon_tokens_entrada"]) / 1_000_000
    total += salida * float(tarifa["usd_millon_tokens_salida"]) / 1_000_000
    return {
        "estado": "estimado_con_uso_real",
        "usd": total,
        "tokens_entrada": entrada,
        "tokens_salida": salida,
        "fuente": tarifa["fuente"],
        "fecha_tarifa": tarifa["fecha"],
    }


def metricas_decision(predicciones: Sequence[Prediccion]) -> dict[str, Any]:
    por_grupo: dict[str, dict[str, float | int]] = {}
    for grupo in GRUPOS_ESPERADOS:
        filas = [p for p in predicciones if p.grupo == grupo]
        aciertos = sum(p.esperada == p.predicha for p in filas)
        por_grupo[grupo] = {
            "aciertos": aciertos,
            "total": len(filas),
            "proporcion": aciertos / len(filas) if filas else 0.0,
        }

    no_incidencias = [p for p in predicciones if p.incidencia_valida_esperada is False]
    recall_no_incidencia = (
        sum(p.incidencia_valida_predicha is False for p in no_incidencias) / len(no_incidencias)
        if no_incidencias
        else None
    )
    autollenadas = [p for p in predicciones if p.accion_predicha == "autollenar"]
    precision_autollenar = (
        sum(p.esperada == p.predicha for p in autollenadas) / len(autollenadas) if autollenadas else None
    )

    orden_prioridad = {valor: indice for indice, valor in enumerate(("baja", "media", "alta", "critica"))}
    prioridades = [
        p for p in predicciones if p.prioridad_esperada in orden_prioridad and p.prioridad_predicha in orden_prioridad
    ]
    prioridad_exacta = (
        sum(p.prioridad_esperada == p.prioridad_predicha for p in prioridades) / len(prioridades)
        if prioridades
        else None
    )
    prioridad_un_nivel = (
        sum(
            abs(orden_prioridad[str(p.prioridad_esperada)] - orden_prioridad[str(p.prioridad_predicha)]) <= 1
            for p in prioridades
        )
        / len(prioridades)
        if prioridades
        else None
    )
    adversarias = [p for p in predicciones if p.grupo == "adversaria"]
    cambios_adversarios = sum(p.esperada != p.predicha for p in adversarias)
    return {
        "exactitud_por_grupo": por_grupo,
        "recall_no_incidencia": recall_no_incidencia,
        "precision_autollenar": precision_autollenar,
        "prioridad_exacta": prioridad_exacta,
        "prioridad_dentro_de_un_nivel": prioridad_un_nivel,
        "adversarias": {"cambios_clasificacion": cambios_adversarios, "total": len(adversarias)},
    }


def calcular_metricas(
    predicciones: Sequence[Prediccion],
    fallos: Sequence[Fallo] = (),
    tarifa: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    clases = metricas_clases(predicciones)
    latencias_totales = [p.latencia_total_ms for p in predicciones if p.latencia_total_ms is not None]
    latencias_proveedor = [p.latencia_proveedor_ms for p in predicciones if p.latencia_proveedor_ms is not None]
    total_intentos = len(predicciones) + len(fallos)
    return {
        "orden_categorias": list(CATEGORIAS),
        "exactitud_por_categoria": exactitud_por_categoria(predicciones),
        "metricas_por_clase": clases,
        "macro_f1": sum(float(clases[c]["f1"]) for c in CATEGORIAS) / len(CATEGORIAS),
        "matriz_confusion": matriz_confusion(predicciones),
        "calibracion": calibracion(predicciones),
        "metricas_decision": metricas_decision(predicciones),
        "latencia_total_ms": {
            "p50": percentil_rango_mas_cercano(latencias_totales, 0.50),
            "p95": percentil_rango_mas_cercano(latencias_totales, 0.95),
        },
        "latencia_proveedor_ms": {
            "p50": percentil_rango_mas_cercano(latencias_proveedor, 0.50),
            "p95": percentil_rango_mas_cercano(latencias_proveedor, 0.95),
        },
        "costo": calcular_costo(predicciones, tarifa),
        "predicciones_validas": len(predicciones),
        "fallos": len(fallos),
        "tasa_error": len(fallos) / total_intentos if total_intentos else 0.0,
    }


def calcular_kappa(registros: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    pares: list[tuple[str, str]] = []
    for registro in registros:
        a = registro.get("etiqueta_evaluador_a")
        b = registro.get("etiqueta_evaluador_b")
        if not isinstance(a, str) or not isinstance(b, str) or a not in CATEGORIAS or b not in CATEGORIAS:
            return {
                "calculable": False,
                "motivo": "Se requieren dos etiquetas humanas independientes validas en todas las imagenes",
            }
        pares.append((a, b))
    if not pares:
        return {"calculable": False, "motivo": "No hay anotaciones"}
    acuerdo = sum(a == b for a, b in pares) / len(pares)
    conteo_a = Counter(a for a, _ in pares)
    conteo_b = Counter(b for _, b in pares)
    esperado = sum(conteo_a[c] / len(pares) * conteo_b[c] / len(pares) for c in CATEGORIAS)
    kappa = 1.0 if esperado == 1.0 and acuerdo == 1.0 else (acuerdo - esperado) / (1 - esperado)
    return {"calculable": True, "kappa": kappa, "acuerdo_observado": acuerdo, "pares": len(pares)}


def cargar_jsonl(ruta: Path) -> list[dict[str, Any]]:
    if not ruta.is_file():
        raise ManifiestoInvalido(f"No existe el manifiesto: {ruta}")
    registros: list[dict[str, Any]] = []
    for numero, linea in enumerate(ruta.read_text(encoding="utf-8").splitlines(), 1):
        if not linea.strip():
            continue
        try:
            valor = json.loads(linea)
        except json.JSONDecodeError as exc:
            raise ManifiestoInvalido(f"JSON invalido en la linea {numero}") from exc
        if not isinstance(valor, dict):
            raise ManifiestoInvalido(f"La linea {numero} no es un objeto")
        registros.append(valor)
    return registros


def validar_estructura_manifiesto(registros: Sequence[Mapping[str, Any]]) -> None:
    conteos = Counter(r.get("grupo") for r in registros)
    if len(registros) != sum(GRUPOS_ESPERADOS.values()) or conteos != Counter(GRUPOS_ESPERADOS):
        raise ManifiestoInvalido(f"Composicion invalida: {dict(conteos)}; esperada: {GRUPOS_ESPERADOS}")
    ids: set[str] = set()
    rutas: set[str] = set()
    for indice, registro in enumerate(registros, 1):
        identificador = registro.get("id")
        ruta = registro.get("ruta_procesada")
        if registro.get("esquema") != "utm-desk-eval-imagen-v1":
            raise ManifiestoInvalido(f"Registro {indice}: esquema desconocido")
        if not isinstance(identificador, str) or not identificador:
            raise ManifiestoInvalido(f"Registro {indice}: id ausente")
        if identificador in ids:
            raise ManifiestoInvalido(f"ID duplicado: {identificador}")
        ids.add(identificador)
        if not isinstance(ruta, str) or not ruta:
            raise ManifiestoInvalido(f"Registro {identificador}: ruta_procesada ausente")
        if ruta in rutas:
            raise ManifiestoInvalido(f"Ruta duplicada: {ruta}")
        rutas.add(ruta)
        if registro.get("pipeline") != PIPELINE_CLIENTE:
            raise ManifiestoInvalido(f"Registro {identificador}: pipeline no autorizado")


def _leer_segmentos_jpeg(datos: bytes) -> Iterable[tuple[int, bytes]]:
    if not datos.startswith(b"\xff\xd8"):
        raise ManifiestoInvalido("La imagen procesada no es JPEG")
    posicion = 2
    while posicion + 4 <= len(datos):
        if datos[posicion] != 0xFF:
            break
        marcador = datos[posicion + 1]
        posicion += 2
        if marcador in {0xD8, 0xD9}:
            continue
        if marcador == 0xDA:
            break
        longitud = int.from_bytes(datos[posicion : posicion + 2], "big")
        if longitud < 2 or posicion + longitud > len(datos):
            raise ManifiestoInvalido("JPEG truncado o mal formado")
        yield marcador, datos[posicion + 2 : posicion + longitud]
        posicion += longitud


def contiene_exif(datos: bytes) -> bool:
    marcadores_metadatos = {0xE1, 0xED, 0xFE}  # EXIF/XMP, IPTC y comentarios
    return any(marcador in marcadores_metadatos for marcador, _ in _leer_segmentos_jpeg(datos))


def dimensiones_jpeg(datos: bytes) -> tuple[int, int]:
    marcadores_sof = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
    for marcador, carga in _leer_segmentos_jpeg(datos):
        if marcador in marcadores_sof and len(carga) >= 5:
            alto = int.from_bytes(carga[1:3], "big")
            ancho = int.from_bytes(carga[3:5], "big")
            if ancho > 0 and alto > 0:
                return ancho, alto
    raise ManifiestoInvalido("El JPEG no contiene dimensiones validas")


def validar_set_completo(registros: Sequence[Mapping[str, Any]], directorio: Path) -> None:
    campos_humanos = (
        "evaluador_a",
        "evaluador_b",
        "etiqueta_evaluador_a",
        "etiqueta_evaluador_b",
        "etiqueta_final",
        "estado_consenso",
        "procedencia",
        "licencia",
        "sha256",
    )
    pendientes: list[str] = []
    for registro in registros:
        identificador = str(registro["id"])
        if any(not registro.get(campo) for campo in campos_humanos):
            pendientes.append(identificador)
            continue
        if registro["evaluador_a"] == registro["evaluador_b"]:
            raise ManifiestoInvalido(f"{identificador}: los evaluadores deben ser dos personas distintas")
        if any(
            registro[campo] not in CATEGORIAS
            for campo in ("etiqueta_evaluador_a", "etiqueta_evaluador_b", "etiqueta_final")
        ):
            raise ManifiestoInvalido(f"{identificador}: etiqueta fuera del contrato")
        if registro["estado_consenso"] not in {"acuerdo_directo", "adjudicado"}:
            raise ManifiestoInvalido(f"{identificador}: estado_consenso invalido")
        if (
            registro.get("autorizada_envio_externo") is not True
            or registro.get("sin_rostros_identificables") is not True
        ):
            raise ManifiestoInvalido(f"{identificador}: falta autorizacion o verificacion de privacidad")
        if registro.get("exif_verificado") is not True:
            raise ManifiestoInvalido(f"{identificador}: falta declarar la verificacion EXIF")
        sha256 = registro["sha256"]
        if not isinstance(sha256, str) or len(sha256) != 64 or any(c not in "0123456789abcdef" for c in sha256):
            raise ManifiestoInvalido(f"{identificador}: SHA-256 invalido")
        ruta = (directorio / str(registro["ruta_procesada"])).resolve()
        try:
            ruta.relative_to(directorio.resolve())
        except ValueError as exc:
            raise ManifiestoInvalido(f"{identificador}: ruta fuera del directorio autorizado") from exc
        if not ruta.is_file():
            pendientes.append(identificador)
            continue
        datos = ruta.read_bytes()
        if len(datos) > MAX_BYTES_PIPELINE:
            raise ManifiestoInvalido(f"{identificador}: excede el limite del pipeline")
        if hashlib.sha256(datos).hexdigest() != sha256:
            raise ManifiestoInvalido(f"{identificador}: SHA-256 no coincide")
        if contiene_exif(datos):
            raise ManifiestoInvalido(f"{identificador}: contiene EXIF/XMP/IPTC o comentarios")
        if max(dimensiones_jpeg(datos)) > MAX_LADO_PIPELINE:
            raise ManifiestoInvalido(f"{identificador}: dimensiones ajenas al pipeline")
    if pendientes:
        muestra = ", ".join(pendientes[:5])
        raise EtiquetadoIncompleto(
            f"El set no esta listo ({len(pendientes)} registros pendientes; primeros: {muestra})"
        )


def cargar_tarifa(ruta: Path | None, proveedor: str) -> Mapping[str, Any] | None:
    if ruta is None:
        return None
    documento = json.loads(ruta.read_text(encoding="utf-8"))
    tarifa = documento.get(proveedor)
    if not isinstance(tarifa, dict):
        raise ErrorEvaluacion(f"No hay tarifa auditable para {proveedor}")
    return tarifa


async def llamar_proveedor_produccion(proveedor: str, datos: bytes, media_type: str) -> RespuestaProveedor:
    """Llama al adaptador del puerto ProveedorVision (#28) sin contexto: solo la imagen."""
    from app.services.vision import obtener_proveedor

    adaptador = obtener_proveedor(proveedor)
    inicio = time.monotonic()
    analisis = await adaptador.analizar(datos, media_type, None)
    latencia = (time.monotonic() - inicio) * 1000
    return RespuestaProveedor(
        analisis=analisis.model_dump(mode="json", exclude_none=True), latencia_proveedor_ms=latencia
    )


def _tipo_fallo(exc: BaseException) -> str:
    from app.services.vision.puerto import ErrorProveedor

    if isinstance(exc, ErrorProveedor):
        return {
            "timeout": "timeout",
            "respuesta_invalida": "respuesta_invalida",
            "configuracion": "proveedor_no_disponible",
            "http_429": "limite_cuota",
        }.get(exc.tipo, "error_proveedor")
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
        return "timeout"
    if isinstance(exc, (ValidationError, ValueError, KeyError)):
        return "respuesta_invalida"
    if isinstance(exc, CredencialesNoDisponibles):
        return "credenciales_no_disponibles"
    if isinstance(exc, ProveedorNoDisponible):
        return "proveedor_no_disponible"
    if getattr(exc, "status_code", None) == 429:
        return "limite_cuota"
    return "error_proveedor"


def validar_disponibilidad_proveedor(proveedor: str) -> None:
    """Falla antes de la corrida si faltan credenciales o el proveedor está bloqueado (p. ej. capa gratuita)."""
    from app.core.config import settings
    from app.services.vision import obtener_proveedor
    from app.services.vision.puerto import ErrorProveedor

    clave = settings.gemini_api_key if proveedor == "gemini" else settings.anthropic_api_key
    if not clave:
        raise CredencialesNoDisponibles(f"No hay credenciales de {proveedor} configuradas")
    try:
        obtener_proveedor(proveedor)
    except ErrorProveedor as exc:
        raise ProveedorNoDisponible(str(exc)) from exc


def contexto_ejecucion(proveedor: str) -> dict[str, Any]:
    try:
        git_dir = RAIZ_BACKEND.parent / ".git"
        head = (git_dir / "HEAD").read_text(encoding="ascii").strip()
        if head.startswith("ref: "):
            referencia = head.removeprefix("ref: ")
            archivo_ref = git_dir / referencia
            if archivo_ref.is_file():
                commit = archivo_ref.read_text(encoding="ascii").strip()
            else:
                lineas = (git_dir / "packed-refs").read_text(encoding="ascii").splitlines()
                commit = next(linea.split()[0] for linea in lineas if linea.endswith(f" {referencia}"))
        else:
            commit = head
    except (OSError, StopIteration):
        commit = "no_disponible"
    from app.core.config import settings
    from app.services.vision.prompt import PROMPT_SISTEMA, PROMPT_VERSION

    version_prompt = f"{PROMPT_VERSION}+sha256:{hashlib.sha256(PROMPT_SISTEMA.encode()).hexdigest()[:16]}"
    modelo = settings.gemini_modelo if proveedor == "gemini" else settings.ia_modelo
    return {
        "commit": commit,
        "version_prompt": version_prompt,
        "modelo": modelo,
        "pipeline_cliente": PIPELINE_CLIENTE,
        "python": sys.version.split()[0],
    }


async def ejecutar_evaluacion(
    registros: Sequence[Mapping[str, Any]],
    directorio: Path,
    proveedor: str,
    repeticiones: int,
    llamar: Callable[[str, bytes, str], Awaitable[RespuestaProveedor]],
    progreso: Callable[[str], None] = print,
) -> tuple[list[Prediccion], list[Fallo]]:
    predicciones: list[Prediccion] = []
    fallos: list[Fallo] = []
    for repeticion in range(1, repeticiones + 1):
        for indice, registro in enumerate(registros, 1):
            identificador = str(registro["id"])
            progreso(f"[{repeticion}/{repeticiones}] {indice}/{len(registros)} {identificador}")
            datos = (directorio / str(registro["ruta_procesada"])).read_bytes()
            inicio = time.monotonic()
            try:
                respuesta = await llamar(proveedor, datos, "image/jpeg")
                duracion = (time.monotonic() - inicio) * 1000
                from app.schemas.ia import AnalisisImagen

                analisis = AnalisisImagen.model_validate(respuesta.analisis).model_dump()
                confianza = analisis["confianza"]
                predicciones.append(
                    Prediccion(
                        imagen_id=identificador,
                        repeticion=repeticion,
                        esperada=str(registro["etiqueta_final"]),
                        predicha=str(analisis["categoria"]),
                        confianza=float(confianza),
                        grupo=str(registro["grupo"]),
                        incidencia_valida_esperada=registro.get("es_incidencia_valida_final"),
                        incidencia_valida_predicha=analisis["es_incidencia_valida"],
                        prioridad_esperada=registro.get("prioridad_final"),
                        prioridad_predicha=analisis["prioridad_sugerida"],
                        accion_esperada=registro.get("accion_final"),
                        accion_predicha=analisis.get("accion"),
                        latencia_total_ms=duracion,
                        latencia_proveedor_ms=respuesta.latencia_proveedor_ms,
                        tokens_entrada=respuesta.tokens_entrada,
                        tokens_salida=respuesta.tokens_salida,
                    )
                )
            except Exception as exc:  # se registra sin texto potencialmente sensible
                fallos.append(Fallo(identificador, repeticion, _tipo_fallo(exc)))
    return predicciones, fallos


def _consistencia(predicciones: Sequence[Prediccion], campo: str) -> float | None:
    por_imagen: dict[str, list[Any]] = {}
    for prediccion in predicciones:
        por_imagen.setdefault(prediccion.imagen_id, []).append(getattr(prediccion, campo))
    completas = [valores for valores in por_imagen.values() if len(valores) > 1 and all(v is not None for v in valores)]
    if not completas:
        return None
    return sum(len(set(valores)) == 1 for valores in completas) / len(completas)


def construir_reporte(
    proveedor: str,
    repeticiones: int,
    predicciones: Sequence[Prediccion],
    fallos: Sequence[Fallo],
    tarifa: Mapping[str, Any] | None,
    registros: Sequence[Mapping[str, Any]],
    contexto: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    por_repeticion = []
    for numero in range(1, repeticiones + 1):
        p = [x for x in predicciones if x.repeticion == numero]
        f = [x for x in fallos if x.repeticion == numero]
        por_repeticion.append({"repeticion": numero, "metricas": calcular_metricas(p, f, tarifa)})
    f1 = [r["metricas"]["macro_f1"] for r in por_repeticion]
    return {
        "esquema": "utm-desk-eval-ia-v1",
        "generado_en": datetime.now(timezone.utc).isoformat(),
        "proveedor": proveedor,
        "repeticiones": repeticiones,
        "imagenes": len(registros),
        "contexto": dict(contexto or {}),
        "kappa": calcular_kappa(registros),
        "agregado": calcular_metricas(predicciones, fallos, tarifa),
        "por_repeticion": por_repeticion,
        "variacion_macro_f1": {
            "min": min(f1) if f1 else None,
            "max": max(f1) if f1 else None,
            "desviacion_poblacional": statistics.pstdev(f1) if len(f1) > 1 else 0.0 if f1 else None,
        },
        "consistencia": {
            "categoria": _consistencia(predicciones, "predicha"),
            "accion": _consistencia(predicciones, "accion_predicha"),
        },
        "predicciones_detalle": [asdict(prediccion) for prediccion in predicciones],
        "fallos_detalle": [asdict(fallo) for fallo in fallos],
    }


def construir_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Evalua el set autorizado con el pipeline de IA real")
    parser.add_argument("--proveedor", required=True, choices=("claude", "gemini"))
    parser.add_argument("--repeticiones", required=True, type=int)
    parser.add_argument("--manifiesto", type=Path, default=MANIFIESTO_PREDETERMINADO)
    parser.add_argument("--salida", type=Path)
    parser.add_argument("--tarifas", type=Path, help="JSON versionado con fuente y fecha de precios")
    parser.add_argument("--solo-validar", action="store_true")
    return parser


def validar_argumentos(args: argparse.Namespace) -> None:
    if args.repeticiones < 1:
        raise ErrorEvaluacion("--repeticiones debe ser mayor que cero")


async def _principal_async(args: argparse.Namespace) -> int:
    validar_argumentos(args)
    manifiesto = args.manifiesto.resolve()
    registros = cargar_jsonl(manifiesto)
    validar_estructura_manifiesto(registros)
    kappa = calcular_kappa(registros)
    if args.solo_validar:
        print(json.dumps({"estructura": "valida", "imagenes": len(registros), "kappa": kappa}, ensure_ascii=False))
        return 0 if kappa["calculable"] else 2
    validar_set_completo(registros, manifiesto.parent)
    validar_disponibilidad_proveedor(args.proveedor)
    tarifa = cargar_tarifa(args.tarifas, args.proveedor)
    predicciones, fallos = await ejecutar_evaluacion(
        registros, manifiesto.parent, args.proveedor, args.repeticiones, llamar_proveedor_produccion
    )
    reporte = construir_reporte(
        args.proveedor,
        args.repeticiones,
        predicciones,
        fallos,
        tarifa,
        registros,
        contexto_ejecucion(args.proveedor),
    )
    contenido = json.dumps(reporte, ensure_ascii=False, indent=2)
    print(contenido)
    if args.salida:
        args.salida.write_text(contenido + "\n", encoding="utf-8")
    return 0 if predicciones and not fallos else 3


def main(argv: Sequence[str] | None = None) -> int:
    parser = construir_parser()
    try:
        args = parser.parse_args(argv)
        return asyncio.run(_principal_async(args))
    except ErrorEvaluacion as exc:
        print(f"Error de evaluacion: {exc}", file=sys.stderr)
        return 2
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"Error de entrada: {exc}", file=sys.stderr)
        return 2
    except Exception:
        print("Error inesperado durante la evaluacion; revisa la configuracion local", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
