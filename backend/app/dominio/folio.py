"""Formato de folios de incidencias, sin acceso a Redis ni MongoDB."""

import re
from datetime import datetime
from zoneinfo import ZoneInfo

PREFIJOS: dict[str, str] = {
    "computo_redes": "RED",
    "infraestructura": "INF",
    "academico": "ACA",
}
ZONA_CAMPUS = ZoneInfo("America/Mexico_City")


def fecha_local_campus(fecha: datetime) -> datetime:
    """Convierte una fecha consciente de zona horaria a la hora del campus."""
    if fecha.tzinfo is None or fecha.utcoffset() is None:
        raise ValueError("La fecha del folio debe incluir zona horaria")
    return fecha.astimezone(ZONA_CAMPUS)


def prefijo_folio(categoria: str, fecha: datetime, prefijo_categoria: str | None = None) -> str:
    """Construye la parte estable del folio para categoría y día local."""
    prefijo_categoria = PREFIJOS.get(categoria, prefijo_categoria)
    if prefijo_categoria is None or re.fullmatch(r"[A-Z]{3}", prefijo_categoria) is None:
        raise ValueError(f"Categoría de folio desconocida: {categoria}")
    local = fecha_local_campus(fecha)
    return f"INC-{local:%Y}-{local:%m%d}-{prefijo_categoria}-"


def formatear_folio(
    categoria: str,
    consecutivo: int,
    fecha: datetime,
    prefijo_categoria: str | None = None,
) -> str:
    """Construye ``INC-YYYY-MMDD-PREFIX-NNNN`` con el día local del campus."""
    if isinstance(consecutivo, bool) or consecutivo < 1:
        raise ValueError("El consecutivo del folio debe ser un entero positivo")
    return f"{prefijo_folio(categoria, fecha, prefijo_categoria)}{consecutivo:04d}"
