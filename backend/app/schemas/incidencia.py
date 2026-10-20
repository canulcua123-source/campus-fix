import re
import unicodedata
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, IPvAnyAddress, field_validator

Prioridad = Literal["baja", "media", "alta", "critica"]
Estado = Literal["abierta", "en_proceso", "en_espera", "resuelta", "cerrada"]


class DetalleComputo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    categoria: Literal["computo_redes"]
    ip: IPvAnyAddress
    vlan: int = Field(ge=1, le=4094)
    puerto_uplink: str = Field(max_length=20)
    equipos_afectados: int = Field(ge=1, le=10000)


class DetalleInfra(BaseModel):
    model_config = ConfigDict(extra="forbid")

    categoria: Literal["infraestructura"]
    tipo_dano: Literal["filtracion", "electrico", "climatizacion", "cerrajeria", "luminaria", "otro"]
    riesgo_seguridad: Literal["bajo", "medio", "alto"]
    requiere_insumos: bool
    insumos: list[Annotated[str, Field(min_length=1, max_length=60)]] | None = Field(default=None, max_length=10)
    requiere_contratista: bool


class DetalleAcademico(BaseModel):
    model_config = ConfigDict(extra="forbid")

    categoria: Literal["academico"]
    plataforma: Literal["lms", "portal_calificaciones", "correo"]
    codigo_curso: str = Field(pattern=r"^[A-Z]{2,4}-\d{3}$")
    periodo: str = Field(pattern=r"^\d{4}-[12]$")
    estudiantes_impactados: int = Field(ge=0, le=100000)


DetalleEspecifico = Annotated[
    DetalleComputo | DetalleInfra | DetalleAcademico, Field(discriminator="categoria")
]


class Ubicacion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    edificio: str = Field(min_length=1, max_length=60)
    piso: int | None = Field(default=None, ge=-5, le=50)
    aula: str = Field(min_length=1, max_length=60)


class IncidenciaIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    titulo: str = Field(min_length=5, max_length=120)
    descripcion: str = Field(min_length=10, max_length=2000)
    prioridad: Prioridad
    ubicacion: Ubicacion
    detalle_especifico: DetalleEspecifico
    tags: list[str] = Field(default_factory=list, max_length=15)

    @field_validator("tags")
    @classmethod
    def _tags(cls, v: list[str]) -> list[str]:
        return sorted({normalizar_tag(t) for t in v})


class SeguimientoIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    estado_nuevo: Estado
    comentario: str = Field(min_length=5, max_length=1000)
    horas: float = Field(ge=0, le=24)


TRANSICIONES: dict[str, list[str]] = {
    "abierta": ["en_proceso", "en_espera"],
    "en_proceso": ["en_espera", "resuelta"],
    "en_espera": ["en_proceso"],
    "resuelta": ["cerrada", "en_proceso"],
    "cerrada": [],
}

_RE_TAG = re.compile(r"^[a-z0-9_]{2,30}$")


def normalizar_tag(texto: str) -> str:
    """minúsculas, sin acentos, espacios -> _ ; ValueError si no cumple ^[a-z0-9_]{2,30}$."""
    sin_acentos = "".join(
        c for c in unicodedata.normalize("NFD", texto.strip().lower()) if unicodedata.category(c) != "Mn"
    )
    tag = re.sub(r"\s+", "_", sin_acentos)
    if not _RE_TAG.match(tag):
        raise ValueError(f"Tag inválido: {texto!r}")
    return tag


class TagsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tags: list[str] = Field(min_length=1, max_length=15)

    @field_validator("tags")
    @classmethod
    def _tags(cls, v: list[str]) -> list[str]:
        return sorted({normalizar_tag(t) for t in v})
