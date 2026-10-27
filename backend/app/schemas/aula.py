"""Contratos públicos del catálogo de aulas."""

from pydantic import BaseModel, ConfigDict, Field


class UbicacionAulaOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    edificio: str = Field(min_length=1, max_length=60)
    piso: int = Field(ge=-5, le=50)
    aula: str = Field(min_length=1, max_length=60)


class AulaResueltaOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id_publico: str = Field(pattern=r"^[A-Za-z0-9_-]{22}$")
    ubicacion: UbicacionAulaOut


class AulaCatalogoOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id_publico: str = Field(pattern=r"^[A-Za-z0-9_-]{22}$")
    piso: int = Field(ge=-5, le=50)
    aula: str = Field(min_length=1, max_length=60)
    activa: bool


class EdificioCatalogoOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    edificio: str = Field(min_length=1, max_length=60)
    total_aulas: int = Field(ge=0)
    activas: int = Field(ge=0)
    pisos: list[int] = Field(max_length=56)
    aulas: list[AulaCatalogoOut]
