"""Reglas del ciclo de vida de una incidencia."""

from datetime import datetime, timedelta, timezone

VENTANA_RETIRO = timedelta(minutes=15)

TRANSICIONES: dict[str, list[str]] = {
    "abierta": ["en_proceso", "en_espera"],
    "en_proceso": ["en_espera", "resuelta"],
    "en_espera": ["en_proceso"],
    "resuelta": ["cerrada", "en_proceso"],
    "cerrada": [],
    "retirada": [],
}


class TransicionEstadoInvalida(ValueError):
    """Indica que un cambio de estado no pertenece al flujo permitido."""


class AccionReportanteInvalida(ValueError):
    """Indica que el reportante no puede confirmar o reabrir la incidencia."""


def transicion_permitida(estado_actual: str, estado_nuevo: str) -> bool:
    """Devuelve si la transición solicitada está definida por el dominio."""
    return estado_nuevo in TRANSICIONES.get(estado_actual, [])


def validar_transicion(estado_actual: str, estado_nuevo: str) -> None:
    """Valida una transición y falla con una excepción propia del dominio."""
    if not transicion_permitida(estado_actual, estado_nuevo):
        raise TransicionEstadoInvalida(f"Transición no permitida: {estado_actual} -> {estado_nuevo}")


def origenes_permitidos(estado_nuevo: str) -> list[str]:
    """Obtiene los estados desde los que se puede alcanzar el destino."""
    return [estado for estado, destinos in TRANSICIONES.items() if estado_nuevo in destinos]


def ahora_utc() -> datetime:
    """Reloj del servidor, separado para permitir pruebas deterministas."""
    return datetime.now(timezone.utc)


def retiro_en_ventana(fecha_creacion: datetime | None, ahora: datetime) -> bool:
    """Comprueba la ventana inclusiva de retiro sin confiar en tiempo del cliente."""
    if not isinstance(fecha_creacion, datetime) or not isinstance(ahora, datetime):
        return False
    if fecha_creacion.tzinfo is None or ahora.tzinfo is None:
        return False
    return ahora - VENTANA_RETIRO <= fecha_creacion <= ahora


def validar_confirmacion_reportante(estado_actual: str) -> None:
    """La confirmación del reportante solamente cierra una incidencia resuelta."""
    if estado_actual != "resuelta":
        raise AccionReportanteInvalida("Solo se puede confirmar una incidencia resuelta")


def validar_reapertura_reportante(
    estado_actual: str,
    fecha_resolucion: datetime | None,
    ahora: datetime,
) -> None:
    """Valida la reapertura especial resuelta -> abierta dentro de siete días."""
    if estado_actual != "resuelta":
        raise AccionReportanteInvalida("Solo se puede reabrir una incidencia resuelta")
    if fecha_resolucion is None or fecha_resolucion.tzinfo is None:
        raise AccionReportanteInvalida("La incidencia no tiene una fecha de resolución válida")
    if ahora.tzinfo is None:
        raise ValueError("ahora debe incluir zona horaria")
    if not ahora - timedelta(days=7) <= fecha_resolucion <= ahora:
        raise AccionReportanteInvalida("El plazo de siete días para reabrir venció")
