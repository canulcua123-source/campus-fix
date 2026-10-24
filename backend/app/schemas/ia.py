from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class CampoDetectado(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nombre: str
    valor: str


class AnalisisImagen(BaseModel):
    """Salida estructurada de la IA. Sin defaults: todos los campos son requeridos."""

    model_config = ConfigDict(extra="forbid")

    es_incidencia_valida: bool
    categoria: Literal["computo_redes", "infraestructura", "academico", "no_determinada"]
    titulo: str
    descripcion: str
    prioridad_sugerida: Literal["baja", "media", "alta", "critica"]
    tags: list[str]
    campos_detectados: list[CampoDetectado]
    confianza: float = Field(ge=0, le=1)
    advertencias: list[str]


class RespuestaAnalisisImagen(AnalisisImagen):
    """Respuesta del endpoint, incluyendo el origen del análisis."""

    cache: bool
