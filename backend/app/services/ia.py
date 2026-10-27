"""Fachada de IA: delega en el proveedor configurado (puerto ProveedorVision) y concentra los reintentos."""

import asyncio
import random
from collections.abc import Awaitable, Callable

from app.core.config import settings
from app.schemas.ia import AnalisisImagen
from app.services.vision import obtener_proveedor
from app.services.vision.prompt import PROMPT_VERSION
from app.services.vision.puerto import TIMEOUT_PROVEEDOR_SEGUNDOS, ErrorProveedor

# Presupuesto: 2 intentos de 13.5 s + backoff (≤ 0.5 s) caben en el deadline total de 28 s,
# por debajo del abort del cliente (TIMEOUT_IA_MS = 30 s) para que el reintento sí llegue al usuario.
IA_TIMEOUT_SEGUNDOS = TIMEOUT_PROVEEDOR_SEGUNDOS
IA_DEADLINE_TOTAL_SEGUNDOS = 28.0
IA_INTENTOS_MAXIMOS = 2
BACKOFF_BASE_SEGUNDOS = 0.25
BACKOFF_JITTER_SEGUNDOS = 0.25
BACKOFF_MAX_SEGUNDOS = 0.5

# Compatibilidad: el error de la fachada es el error normalizado del puerto.
IAError = ErrorProveedor

_esperar = asyncio.sleep
_aleatorio_uniforme = random.uniform

__all__ = [
    "PROMPT_VERSION",
    "IAError",
    "analizar_imagen",
    "con_reintento_transitorio",
    "identidad_proveedor",
]


def identidad_proveedor() -> tuple[str, str]:
    """(proveedor, modelo) configurados; forman parte de la clave de caché del análisis."""
    if settings.ia_proveedor == "gemini":
        return "gemini", settings.gemini_modelo
    return "claude", settings.ia_modelo


async def analizar_imagen(imagen_bytes: bytes, media_type: str, contexto: str | None = None) -> AnalisisImagen:
    return await obtener_proveedor().analizar(imagen_bytes, media_type, contexto)


def calcular_backoff(numero_reintento: int) -> float:
    """Espera acotada para el único reintento; `numero_reintento` empieza en 1."""
    base = BACKOFF_BASE_SEGUNDOS * (2 ** max(0, numero_reintento - 1))
    jitter = _aleatorio_uniforme(0, BACKOFF_JITTER_SEGUNDOS)
    return min(base + jitter, BACKOFF_MAX_SEGUNDOS)


def _normalizar_error(error: Exception) -> IAError:
    """Los adaptadores ya traducen sus excepciones; cualquier otra cosa es un fallo no transitorio."""
    if isinstance(error, IAError):
        return error
    if isinstance(error, TimeoutError):
        return IAError("El proveedor de IA excedió el tiempo límite", transitorio=True, tipo="timeout")
    return IAError("El proveedor de IA devolvió una respuesta no válida")


async def _intento_con_timeout[T](operacion: Callable[[], Awaitable[T]]) -> T:
    try:
        async with asyncio.timeout(IA_TIMEOUT_SEGUNDOS):
            return await operacion()
    except TimeoutError as error:
        raise IAError(
            "El proveedor de IA excedió el tiempo límite",
            transitorio=True,
            tipo="timeout",
        ) from error


async def con_reintento_transitorio[T](operacion: Callable[[], Awaitable[T]]) -> T:
    """Ejecuta como máximo dos intentos dentro del deadline total y nunca reintenta fallos permanentes."""
    try:
        async with asyncio.timeout(IA_DEADLINE_TOTAL_SEGUNDOS):
            return await _con_reintento(operacion)
    except TimeoutError as error:
        raise IAError(
            "El proveedor de IA excedió el tiempo límite",
            transitorio=True,
            tipo="timeout",
        ) from error


async def _con_reintento[T](operacion: Callable[[], Awaitable[T]]) -> T:
    for intento in range(IA_INTENTOS_MAXIMOS):
        try:
            return await _intento_con_timeout(operacion)
        except Exception as error:
            normalizado = _normalizar_error(error)
            ultimo_intento = intento == IA_INTENTOS_MAXIMOS - 1
            if not normalizado.transitorio or ultimo_intento:
                if normalizado is error:
                    raise
                raise normalizado from error
            await _esperar(calcular_backoff(intento + 1))
    raise AssertionError("Bucle de reintentos de IA sin resultado")
