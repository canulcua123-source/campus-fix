"""Adaptador de Claude (Anthropic) para el puerto ProveedorVision."""

import base64

import anthropic

from app.schemas.ia import AnalisisImagen
from app.services.vision.prompt import PROMPT_SISTEMA, texto_usuario
from app.services.vision.puerto import TIMEOUT_PROVEEDOR_SEGUNDOS, ErrorProveedor, error_http, validar_salida


class ProveedorClaude:
    nombre = "claude"

    def __init__(self, *, api_key: str, modelo: str, cliente=None):
        self.modelo = modelo
        # Cliente creado una sola vez y reutilizado; sin reintentos del SDK (viven en services/ia.py).
        self._cliente = cliente or anthropic.AsyncAnthropic(
            api_key=api_key or None, timeout=TIMEOUT_PROVEEDOR_SEGUNDOS, max_retries=0
        )

    async def analizar(self, imagen: bytes, media_type: str, pistas: str | None) -> AnalisisImagen:
        b64 = base64.standard_b64encode(imagen).decode()
        # Con extra="forbid" cada objeto del schema trae additionalProperties: false y,
        # al no haber defaults, todas las propiedades quedan en `required`.
        schema = AnalisisImagen.model_json_schema()
        try:
            resp = await self._cliente.beta.messages.create(
                model=self.modelo,
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
                            {"type": "text", "text": texto_usuario(pistas)},
                        ],
                    }
                ],
            )
        except anthropic.APITimeoutError as exc:
            raise ErrorProveedor(
                "El proveedor de IA excedió el tiempo límite", transitorio=True, tipo="timeout"
            ) from exc
        except anthropic.APIConnectionError as exc:
            raise ErrorProveedor(
                "Error temporal de transporte con el proveedor de IA", transitorio=True, tipo="transporte"
            ) from exc
        except anthropic.APIStatusError as exc:
            raise error_http(exc.status_code) from exc
        if resp.stop_reason == "refusal":
            raise ErrorProveedor("La IA no pudo analizar la imagen", tipo="negativa")
        texto = next((b.text for b in resp.content if b.type == "text"), None)
        return validar_salida(texto)
