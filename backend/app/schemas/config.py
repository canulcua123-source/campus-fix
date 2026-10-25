from pydantic import BaseModel, ConfigDict, Field, model_validator


class ConfigIA(BaseModel):
    model_config = ConfigDict(extra="forbid")

    habilitada: bool
    limite_diario_usuario: int = Field(ge=1, le=1000)
    limite_diario_global: int = Field(ge=1, le=100000)


class ConfigIAPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    habilitada: bool | None = None
    limite_diario_usuario: int | None = Field(default=None, ge=1, le=1000)
    limite_diario_global: int | None = Field(default=None, ge=1, le=100000)

    @model_validator(mode="after")
    def _parcial_no_vacio_ni_null(self):
        if not self.model_fields_set:
            raise ValueError("Envía al menos un campo de configuración")
        if any(getattr(self, campo) is None for campo in self.model_fields_set):
            raise ValueError("La configuración no admite null")
        return self
