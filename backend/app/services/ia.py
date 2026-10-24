import asyncio
import base64
import random
from collections.abc import Awaitable, Callable

import anthropic

from app.core.config import settings
from app.schemas.ia import AnalisisImagen


IA_TIMEOUT_SEGUNDOS = 25.0
IA_INTENTOS_MAXIMOS = 2
BACKOFF_BASE_SEGUNDOS = 0.25
BACKOFF_JITTER_SEGUNDOS = 0.25
BACKOFF_MAX_SEGUNDOS = 0.5


class IAError(Exception):
    def __init__(self, mensaje: str, *, transitorio: bool = False, tipo: str = "no_transitorio"):
        super().__init__(mensaje)
        self.transitorio = transitorio
        self.tipo = tipo


_esperar = asyncio.sleep
_aleatorio_uniforme = random.uniform


PROMPT_SISTEMA = """Eres un asistente de la mesa de ayuda del campus universitario UTM Desk.
Recibes la foto de una posible incidencia y debes clasificarla en una de estas categorías:
- computo_redes: fallas de cómputo y redes (switches, access points, cableado, equipos de laboratorio, servidores, impresoras de red).
- infraestructura: daños físicos del edificio (filtraciones, electricidad, climatización, cerrajería, luminarias, mobiliario).
- academico: problemas con plataformas académicas (LMS, portal de calificaciones, correo institucional), por ejemplo capturas de errores.
Si no puedes determinarla usa "no_determinada".

Instrucciones:
- Propón un título corto (máximo 80 caracteres) y una descripción clara y objetiva de lo que se ve.
- Prioridad: "critica" solo si hay riesgo de seguridad o un servicio caído que afecta a muchas personas; en otro caso baja, media o alta.
- Sugiere de 3 a 6 tags en snake_case (minúsculas, sin acentos).
- Extrae los campos técnicos visibles en "campos_detectados" (por ejemplo: luminaria fundida, modelo de switch, texto del error del LMS) como pares nombre/valor.
- Indica tu confianza entre 0 y 1 y las advertencias relevantes (foto borrosa, falta contexto, etc.).
- Si la foto NO es una incidencia (selfie, meme, captura irrelevante) pon es_incidencia_valida en false.
- Nunca identifiques personas; ignora los rostros.
Responde únicamente con el JSON que cumple el esquema."""


async def analizar_imagen(imagen_bytes: bytes, media_type: str, contexto: str | None = None) -> AnalisisImagen:
    client = anthropic.AsyncAnthropic(
        api_key=settings.anthropic_api_key or None,
        timeout=IA_TIMEOUT_SEGUNDOS,
        max_retries=0,
    )
    b64 = base64.standard_b64encode(imagen_bytes).decode()
    # Con extra="forbid" cada objeto del schema trae additionalProperties: false y,
    # al no haber defaults, todas las propiedades quedan en `required`.
    schema = AnalisisImagen.model_json_schema()
    resp = await client.beta.messages.create(
        model=settings.ia_modelo,  # "claude-opus-5-5"
        max_tokens=4096,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
        system=PROMPT_SISTEMA,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}},
                    {
                        "type": "text",
                        "text": "Analiza la foto de esta incidencia del campus."
                        + (f" Contexto del usuario: {contexto}" if contexto else ""),
                    },
                ],
            }
        ],
    )
    if resp.stop_reason == "refusal":
        raise IAError("La IA no pudo analizar la imagen")
    texto = next(b.text for b in resp.content if b.type == "text")
    return AnalisisImagen.model_validate_json(texto)


def calcular_backoff(numero_reintento: int) -> float:
    """Espera acotada para el único reintento; `numero_reintento` empieza en 1."""
    base = BACKOFF_BASE_SEGUNDOS * (2 ** max(0, numero_reintento - 1))
    jitter = _aleatorio_uniforme(0, BACKOFF_JITTER_SEGUNDOS)
    return min(base + jitter, BACKOFF_MAX_SEGUNDOS)


def _normalizar_error(error: Exception) -> IAError:
    if isinstance(error, IAError):
        return error
    if isinstance(error, (TimeoutError, anthropic.APITimeoutError)):
        return IAError("El proveedor de IA excedió el tiempo límite", transitorio=True, tipo="timeout")
    if isinstance(error, anthropic.APIConnectionError):
        return IAError("Error temporal de transporte con el proveedor de IA", transitorio=True, tipo="transporte")
    if isinstance(error, anthropic.APIStatusError):
        status = error.status_code
        transitorio = status == 429 or status >= 500
        return IAError(
            "El proveedor de IA respondió con un error",
            transitorio=transitorio,
            tipo=f"http_{status}",
        )
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
    """Ejecuta como máximo dos intentos y nunca reintenta cancelaciones o fallos permanentes."""
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
