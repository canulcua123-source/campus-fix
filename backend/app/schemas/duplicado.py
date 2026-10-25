from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


PATRON_CATEGORIA = r"^[a-z][a-z0-9_]{2,29}$"
PATRON_COINCIDENCIA = r"^[A-Za-z0-9_-]{43}$"


class PosibleDuplicadoOut(BaseModel):
    """Datos publicos minimos de una coincidencia probable."""

    model_config = ConfigDict(extra="forbid")

    accion: Literal["duplicado"]
    coincidencia_id: str = Field(pattern=PATRON_COINCIDENCIA)
    codigo: str = Field(min_length=1, max_length=64)
    categoria: str = Field(pattern=PATRON_CATEGORIA)
    reportado_hace_minutos: int = Field(ge=0, le=1440)
    adhesiones: int = Field(ge=0)


class ConfirmarAdhesionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    coincidencia_id: str = Field(pattern=PATRON_COINCIDENCIA)


class AdhesionOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ok: Literal[True]
    codigo: str = Field(min_length=1, max_length=64)
    categoria: str = Field(pattern=PATRON_CATEGORIA)
    adhesiones: int = Field(ge=1)
    registrada: bool

