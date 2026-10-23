"""Contratos de entrada y salida para los endpoints de analítica."""

import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Annotated, Literal, Self

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, model_validator

CategoriaAnalitica = Literal["computo_redes", "infraestructura", "academico"]
_FECHA_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _fecha_calendario(valor: object) -> date:
    """Acepta solo fechas calendario ISO, sin instantes ni zonas horarias ambiguas."""
    if isinstance(valor, datetime):
        raise ValueError("Debe ser una fecha de calendario AAAA-MM-DD")
    if isinstance(valor, date):
        return valor
    if not isinstance(valor, str) or _FECHA_ISO.fullmatch(valor) is None:
        raise ValueError("Debe ser una fecha de calendario AAAA-MM-DD")
    try:
        return date.fromisoformat(valor)
    except ValueError as exc:
        raise ValueError("La fecha de calendario no existe") from exc


FechaCalendario = Annotated[date, BeforeValidator(_fecha_calendario)]


class FiltrosAnalitica(BaseModel):
    model_config = ConfigDict(extra="forbid")

    desde: FechaCalendario | None = Field(default=None, description="Primer día incluido, en UTC (AAAA-MM-DD)")
    hasta: FechaCalendario | None = Field(default=None, description="Último día incluido, en UTC (AAAA-MM-DD)")
    categoria: CategoriaAnalitica | None = None

    @model_validator(mode="after")
    def _periodo_valido(self) -> Self:
        if self.desde is not None and self.hasta is not None and self.desde > self.hasta:
            raise ValueError("desde no puede ser posterior a hasta")
        if self.hasta == date.max:
            raise ValueError("hasta está fuera del intervalo admitido")
        return self

    def intervalo_utc(self) -> tuple[datetime | None, datetime | None]:
        """Devuelve [desde, día posterior a hasta) para incluir completo el límite superior."""
        inicio = datetime.combine(self.desde, time.min, tzinfo=timezone.utc) if self.desde else None
        fin = (
            datetime.combine(self.hasta + timedelta(days=1), time.min, tzinfo=timezone.utc)
            if self.hasta
            else None
        )
        return inicio, fin

    def para_cache(self) -> dict[str, str | None]:
        return {
            "desde": self.desde.isoformat() if self.desde else None,
            "hasta": self.hasta.isoformat() if self.hasta else None,
            "categoria": self.categoria,
        }


class ResumenAnalitica(BaseModel):
    model_config = ConfigDict(extra="forbid")

    abiertas: int = Field(ge=0)
    en_proceso: int = Field(ge=0)
    criticas: int = Field(ge=0)
    resueltas_periodo: int = Field(ge=0)


class AnaliticaEdificio(BaseModel):
    model_config = ConfigDict(extra="forbid")

    edificio: str = Field(min_length=1, max_length=60)
    total: int = Field(ge=0)
    horas_invertidas: float = Field(ge=0)
    horas_resolucion_prom: float | None = Field(default=None, ge=0)


class AnaliticaTag(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tag: str = Field(min_length=2, max_length=30)
    total: int = Field(ge=0)
