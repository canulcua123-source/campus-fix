"""Reglas del ciclo de vida de una incidencia."""

TRANSICIONES: dict[str, list[str]] = {
    "abierta": ["en_proceso", "en_espera"],
    "en_proceso": ["en_espera", "resuelta"],
    "en_espera": ["en_proceso"],
    "resuelta": ["cerrada", "en_proceso"],
    "cerrada": [],
}


class TransicionEstadoInvalida(ValueError):
    """Indica que un cambio de estado no pertenece al flujo permitido."""


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

