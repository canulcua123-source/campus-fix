"""Valores cerrados del detalle de infraestructura, compartidos por IncidenciaIn y la salida de la IA."""

from enum import StrEnum


class TipoDano(StrEnum):
    FILTRACION = "filtracion"
    ELECTRICO = "electrico"
    CLIMATIZACION = "climatizacion"
    CERRAJERIA = "cerrajeria"
    LUMINARIA = "luminaria"
    OTRO = "otro"


class RiesgoSeguridad(StrEnum):
    BAJO = "bajo"
    MEDIO = "medio"
    ALTO = "alto"
