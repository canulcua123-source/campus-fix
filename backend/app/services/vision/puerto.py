"""Puerto de visión: contrato común para cualquier proveedor de IA (T-028)."""

import json
from typing import Protocol

from pydantic import ValidationError

from app.schemas.ia import AnalisisImagen

# Timeout del SDK/cliente HTTP por intento; el deadline total y los reintentos viven en services/ia.py.
TIMEOUT_PROVEEDOR_SEGUNDOS = 13.5


class ErrorProveedor(Exception):
    """Error normalizado de un proveedor. Solo los transitorios (429, 5xx, timeout, red) se reintentan."""

    def __init__(self, mensaje: str, *, transitorio: bool = False, tipo: str = "no_transitorio"):
        super().__init__(mensaje)
        self.transitorio = transitorio
        self.tipo = tipo


class ProveedorVision(Protocol):
    nombre: str
    modelo: str

    async def analizar(self, imagen: bytes, media_type: str, pistas: str | None) -> AnalisisImagen: ...


def error_http(status: int) -> ErrorProveedor:
    return ErrorProveedor(
        "El proveedor de IA respondió con un error",
        transitorio=status == 429 or status >= 500,
        tipo=f"http_{status}",
    )


def validar_salida(texto: str | None) -> AnalisisImagen:
    """Ambos adaptadores validan con el mismo modelo; una respuesta inválida nunca termina en 500."""
    if not texto:
        raise ErrorProveedor("El proveedor de IA no devolvió contenido", tipo="respuesta_invalida")
    try:
        return AnalisisImagen.model_validate_json(texto)
    except ValidationError as exc:
        reparado = _reparar_detalle_infra(texto)
        if reparado is not None:
            return reparado
        raise ErrorProveedor("El proveedor de IA devolvió una respuesta no válida", tipo="respuesta_invalida") from exc


def _reparar_detalle_infra(texto: str) -> AnalisisImagen | None:
    """Repara de forma determinista solo la incoherencia categoría ↔ detalle_infra; otro error → ``None``.

    - ``detalle_infra`` en una categoría que no es infraestructura: se descarta.
    - infraestructura sin ``detalle_infra``: la categoría baja a ``no_determinada`` (la PWA pregunta la categoría).
    """
    try:
        datos = json.loads(texto)
    except ValueError:
        return None
    if not isinstance(datos, dict):
        return None
    categoria = datos.get("categoria")
    detalle = datos.get("detalle_infra")
    if categoria == "infraestructura" and detalle is None:
        datos["categoria"] = "no_determinada"
        datos.pop("detalle_infra", None)
    elif categoria != "infraestructura" and detalle is not None:
        datos.pop("detalle_infra")
    else:
        return None
    try:
        return AnalisisImagen.model_validate(datos)
    except ValidationError:
        return None
