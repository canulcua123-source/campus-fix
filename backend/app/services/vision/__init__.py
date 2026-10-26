"""Puerto ProveedorVision, adaptadores (Claude, Gemini), prompt y reglas del análisis visual.

`obtener_proveedor()` elige el adaptador según `IA_PROVEEDOR`; cambiar de proveedor no requiere tocar el router.
"""

from collections.abc import Callable

from app.core.config import settings
from app.services.vision.puerto import ErrorProveedor, ProveedorVision

_instancias: dict[tuple[str, str], ProveedorVision] = {}


def falta_configuracion() -> str | None:
    """Motivo por el que el proveedor elegido no podrá responder (sin llave o capa bloqueada); None si está listo."""
    if settings.ia_proveedor == "gemini":
        if not settings.gemini_api_key:
            return "IA_PROVEEDOR=gemini sin GEMINI_API_KEY"
        if settings.gemini_capa == "gratuita" and not settings.ia_permitir_capa_gratuita:
            return "capa gratuita de Gemini bloqueada (IA_PERMITIR_CAPA_GRATUITA=false)"
        return None
    if not settings.anthropic_api_key:
        return "IA_PROVEEDOR=claude sin ANTHROPIC_API_KEY"
    return None


def _crear_claude() -> ProveedorVision:
    from app.services.vision.claude import ProveedorClaude

    return ProveedorClaude(api_key=settings.anthropic_api_key, modelo=settings.ia_modelo)


def _crear_gemini() -> ProveedorVision:
    # La capa gratuita usa el contenido para mejorar productos: prohibida con fotos reales del campus.
    if settings.gemini_capa == "gratuita" and not settings.ia_permitir_capa_gratuita:
        raise ErrorProveedor(
            "La capa gratuita de Gemini está bloqueada (IA_PERMITIR_CAPA_GRATUITA=false)", tipo="configuracion"
        )
    from app.services.vision.gemini import ProveedorGemini

    return ProveedorGemini(api_key=settings.gemini_api_key, modelo=settings.gemini_modelo)


_FABRICAS: dict[str, Callable[[], ProveedorVision]] = {"claude": _crear_claude, "gemini": _crear_gemini}


def _modelo_configurado(nombre: str) -> str:
    return settings.gemini_modelo if nombre == "gemini" else settings.ia_modelo


def obtener_proveedor(nombre: str | None = None) -> ProveedorVision:
    """Fábrica con caché de instancia: el cliente del proveedor se crea una vez y se reutiliza."""
    nombre = nombre or settings.ia_proveedor
    if nombre not in _FABRICAS:
        raise ErrorProveedor(f"Proveedor de IA desconocido: {nombre}", tipo="configuracion")
    clave = (nombre, _modelo_configurado(nombre))
    if clave not in _instancias:
        _instancias[clave] = _FABRICAS[nombre]()
    return _instancias[clave]


def reiniciar_proveedores() -> None:
    """Solo para pruebas o recarga de configuración."""
    _instancias.clear()


__all__ = ["ErrorProveedor", "ProveedorVision", "obtener_proveedor", "reiniciar_proveedores"]
