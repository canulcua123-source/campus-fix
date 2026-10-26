from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, IPvAnyAddress, field_validator, model_validator

from app.dominio.categorias import CATEGORIAS_SISTEMA
from app.dominio.estados import TRANSICIONES as _TRANSICIONES
from app.dominio.tags import normalizar_tag as _normalizar_tag
from app.dominio.tags import normalizar_tags
from app.schemas.ia import IASugerencia

TRANSICIONES = _TRANSICIONES
normalizar_tag = _normalizar_tag

Prioridad = Literal["baja", "media", "alta", "critica"]
Estado = Literal["abierta", "en_proceso", "en_espera", "resuelta", "cerrada", "retirada"]
EstadoSeguimiento = Literal["abierta", "en_proceso", "en_espera", "resuelta", "cerrada"]


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


DetalleEspecifico = Annotated[DetalleComputo | DetalleInfra | DetalleAcademico, Field(discriminator="categoria")]


class DetalleDinamicoEntrada(BaseModel):
    """Contenedor temporal; el router aplica la definicion estricta del catalogo."""

    model_config = ConfigDict(extra="allow")

    categoria: str = Field(min_length=3, max_length=30, pattern=r"^[a-z][a-z0-9_]*$")

    @model_validator(mode="after")
    def _no_suplanta_categoria_sistema(self):
        if self.categoria in CATEGORIAS_SISTEMA:
            raise ValueError("Las categorias del sistema usan su contrato estatico")
        return self


DetalleEntrada = DetalleEspecifico | DetalleDinamicoEntrada


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
    detalle_especifico: DetalleEntrada = Field(
        union_mode="left_to_right",
        description=(
            "Las categorias del sistema usan contratos estaticos; las personalizadas "
            "se validan estrictamente contra la definicion activa del catalogo."
        ),
    )
    tags: list[str] = Field(default_factory=list, max_length=15)
    ia_sugerencia: IASugerencia | None = None

    @field_validator("tags")
    @classmethod
    def _tags(cls, v: list[str]) -> list[str]:
        return normalizar_tags(v)

    @model_validator(mode="after")
    def _ia_sin_null(self):
        if "ia_sugerencia" in self.model_fields_set and self.ia_sugerencia is None:
            raise ValueError("ia_sugerencia no admite null")
        return self


class SeguimientoIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    estado_nuevo: EstadoSeguimiento
    comentario: str = Field(min_length=5, max_length=1000)
    horas: float = Field(ge=0, le=24, multiple_of=0.25, allow_inf_nan=False)


class ConfirmacionIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    accion: Literal["confirmar", "reabrir"]
    comentario: str | None = Field(default=None, min_length=5, max_length=1000)


class ComentarioReportanteIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    comentario: str = Field(min_length=5, max_length=1000)


class AccionEstadoOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ok: bool
    estado: Estado


class TecnicoAsignadoOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    usuario_id: str
    nombre: str


class TomarIncidenciaIn(BaseModel):
    """Cuerpo opcional vacío: impide elegir a otro técnico desde el cliente."""

    model_config = ConfigDict(extra="forbid")


class TomarIncidenciaOut(AccionEstadoOut):
    tecnico_asignado: TecnicoAsignadoOut


class PrioridadIn(BaseModel):
    """PATCH /incidencias/{id}/prioridad (T-052b)."""

    model_config = ConfigDict(extra="forbid")

    prioridad: Prioridad


class TagsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tags: list[str] = Field(min_length=1, max_length=15)

    @field_validator("tags")
    @classmethod
    def _tags(cls, v: list[str]) -> list[str]:
        return normalizar_tags(v)


class EntradaHistorialOut(BaseModel):
    fecha: datetime
    usuario_id: str
    estado_nuevo: Estado
    comentario: str
    horas: float
    tipo: Literal["asignacion", "prioridad"] | None = None
    autor_nombre: str | None = Field(default=None, description="Nombre actual del autor, si sigue disponible")


class IncidenciaDetalleOut(BaseModel):
    """Conserva el expediente y valida la forma enriquecida de su historial."""

    model_config = ConfigDict(extra="allow")
    historial_seguimiento: list[EntradaHistorialOut]
    puede_retirar: bool
