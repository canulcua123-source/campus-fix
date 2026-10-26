from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

CategoriaAgentica = Literal["computo_redes", "infraestructura", "academico"]


def _sin_repetidos(valores: list[str] | None) -> list[str] | None:
    if valores is not None and len(valores) != len(set(valores)):
        raise ValueError("categorias_agenticas no admite repetidos")
    return valores


class ConfigIA(BaseModel):
    """Configuración de IA administrable; MongoDB (`configuracion_ia`) es la fuente de verdad."""

    model_config = ConfigDict(extra="forbid")

    habilitada: bool
    limite_diario_usuario: int = Field(ge=1, le=1000)
    limite_diario_global: int = Field(ge=1, le=100000)
    # Modo agéntico (T-034). El kill switch viene apagado hasta que existan G5/G7/G8 (T17/T18/T22).
    modo_agentico_habilitado: bool = False
    categorias_agenticas: list[CategoriaAgentica] = Field(default_factory=lambda: ["infraestructura"], max_length=3)
    cupo_agentico_usuario_diario: int = Field(default=10, ge=1, le=100)
    cupo_agentico_aula_hora: int = Field(default=3, ge=1, le=100)

    _categorias_unicas = field_validator("categorias_agenticas")(_sin_repetidos)


class ConfigIAPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    habilitada: bool | None = None
    limite_diario_usuario: int | None = Field(default=None, ge=1, le=1000)
    limite_diario_global: int | None = Field(default=None, ge=1, le=100000)
    modo_agentico_habilitado: bool | None = None
    categorias_agenticas: list[CategoriaAgentica] | None = Field(default=None, max_length=3)
    cupo_agentico_usuario_diario: int | None = Field(default=None, ge=1, le=100)
    cupo_agentico_aula_hora: int | None = Field(default=None, ge=1, le=100)

    _categorias_unicas = field_validator("categorias_agenticas")(_sin_repetidos)

    @model_validator(mode="after")
    def _parcial_no_vacio_ni_null(self):
        if not self.model_fields_set:
            raise ValueError("Envía al menos un campo de configuración")
        if any(getattr(self, campo) is None for campo in self.model_fields_set):
            raise ValueError("La configuración no admite null")
        return self
