import base64

import anthropic

from app.core.config import settings
from app.schemas.ia import AnalisisImagen


class IAError(Exception):
    pass


PROVEEDOR_IA = "anthropic"
PROMPT_VERSION = "v1"


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
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key or None)
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
