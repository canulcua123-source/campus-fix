"""Contratos públicos del catálogo de aulas."""

from pydantic import BaseModel, ConfigDict, Field, model_validator


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


class AulaIn(BaseModel):
    """Alta manual de un aula (RF-ADM-04). El `id_publico` lo genera el servidor."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    edificio: str = Field(min_length=1, max_length=60)
    piso: int = Field(ge=-5, le=50, strict=True)
    aula: str = Field(min_length=1, max_length=60)
    activa: bool = Field(default=True, strict=True)


class AulaPatch(BaseModel):
    """Edición parcial: al menos un campo, sin `null`."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    edificio: str | None = Field(default=None, min_length=1, max_length=60)
    piso: int | None = Field(default=None, ge=-5, le=50, strict=True)
    aula: str | None = Field(default=None, min_length=1, max_length=60)
    activa: bool | None = Field(default=None, strict=True)

    @model_validator(mode="after")
    def _no_vacio(self) -> "AulaPatch":
        if not self.model_dump(exclude_none=True):
            raise ValueError("Indica al menos un campo a modificar")
        return self


class AulaOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id_publico: str = Field(pattern=r"^[A-Za-z0-9_-]{22}$")
    edificio: str = Field(min_length=1, max_length=60)
    piso: int = Field(ge=-5, le=50)
    aula: str = Field(min_length=1, max_length=60)
    activa: bool
