"""Adaptador de Gemini (REST con httpx, sin SDK adicional) para el puerto ProveedorVision."""

import base64
import copy

import httpx

from app.schemas.ia import AnalisisImagen
from app.services.vision.prompt import PROMPT_SISTEMA, texto_usuario
from app.services.vision.puerto import TIMEOUT_PROVEEDOR_SEGUNDOS, ErrorProveedor, error_http, validar_salida

URL_BASE = "https://generativelanguage.googleapis.com/v1beta"


def esquema_sin_referencias(esquema: dict) -> dict:
    """Aplana $defs/$ref (CampoDetectado) para la salida estructurada de Gemini."""
    definiciones = esquema.get("$defs", {})

    def resolver(nodo):
        if isinstance(nodo, dict):
            if "$ref" in nodo:
                return resolver(copy.deepcopy(definiciones[nodo["$ref"].rsplit("/", 1)[-1]]))
            return {k: resolver(v) for k, v in nodo.items() if k != "$defs"}
        if isinstance(nodo, list):
            return [resolver(v) for v in nodo]
        return nodo

    return resolver(esquema)


class ProveedorGemini:
    nombre = "gemini"

    def __init__(self, *, api_key: str, modelo: str, cliente: httpx.AsyncClient | None = None):
        self.modelo = modelo
        # Cliente HTTP creado una sola vez y reutilizado; la clave va en cabecera, nunca en la URL.
        self._cliente = cliente or httpx.AsyncClient(
            base_url=URL_BASE, timeout=TIMEOUT_PROVEEDOR_SEGUNDOS, headers={"x-goog-api-key": api_key}
        )

    async def analizar(self, imagen: bytes, media_type: str, pistas: str | None) -> AnalisisImagen:
        cuerpo = {
            "systemInstruction": {"parts": [{"text": PROMPT_SISTEMA}]},
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {"inlineData": {"mimeType": media_type, "data": base64.standard_b64encode(imagen).decode()}},
                        {"text": texto_usuario(pistas)},
                    ],
                }
            ],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseJsonSchema": esquema_sin_referencias(AnalisisImagen.model_json_schema()),
                "mediaResolution": "MEDIA_RESOLUTION_HIGH",
            },
        }
        try:
            resp = await self._cliente.post(f"/models/{self.modelo}:generateContent", json=cuerpo)
        except httpx.TimeoutException as exc:
            raise ErrorProveedor(
                "El proveedor de IA excedió el tiempo límite", transitorio=True, tipo="timeout"
            ) from exc
        except httpx.TransportError as exc:
            raise ErrorProveedor(
                "Error temporal de transporte con el proveedor de IA", transitorio=True, tipo="transporte"
            ) from exc
        if resp.status_code >= 400:
            raise error_http(resp.status_code)
        try:
            datos = resp.json()
        except ValueError as exc:
            raise ErrorProveedor(
                "El proveedor de IA devolvió una respuesta no válida", tipo="respuesta_invalida"
            ) from exc
        if datos.get("promptFeedback", {}).get("blockReason"):
            raise ErrorProveedor("La IA no pudo analizar la imagen", tipo="negativa")
        candidatos = datos.get("candidates") or []
        if not candidatos or candidatos[0].get("finishReason") in {"SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST"}:
            raise ErrorProveedor("La IA no pudo analizar la imagen", tipo="negativa")
        partes = candidatos[0].get("content", {}).get("parts", [])
        texto = "".join(p.get("text", "") for p in partes if isinstance(p, dict))
        return validar_salida(texto)
