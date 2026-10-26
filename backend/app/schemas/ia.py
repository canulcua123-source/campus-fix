from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

PatronIdentificadorAnalisis = r"^[A-Za-z0-9_-]{22,64}$"
PatronCampoIA = r"^(titulo|descripcion|prioridad|tags|detalle_especifico\.[a-z][a-z0-9_]{0,49})$"
CompuertaIA = Literal["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9"]
CampoIA = Annotated[str, Field(pattern=PatronCampoIA)]


def _sin_repetidos(valores: list[str]) -> list[str]:
    if len(valores) != len(set(valores)):
        raise ValueError("La lista no admite elementos repetidos")
    return valores


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


class IASugerencia(BaseModel):
    """Metadatos no personales que T-029/T-036 deben guardar de una sugerencia validada."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    modo: Literal["agentico", "asistido"]
    modelo: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9._:/-]+$")
    version_prompt: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9._-]+$")
    confianza: float = Field(ge=0, le=1, allow_inf_nan=False)
    campos_autollenados: list[CampoIA] = Field(max_length=15)
    proveedor: str | None = Field(default=None, min_length=2, max_length=30, pattern=r"^[a-z][a-z0-9_-]+$")
    analisis_id: str | None = Field(default=None, pattern=PatronIdentificadorAnalisis)
    accion: Literal["agentico", "formulario", "duplicado", "autollenar", "sugerir", "preguntar", "rechazar"] | None = (
        None
    )
    campos_editados_por_usuario: list[CampoIA] | None = Field(default=None, max_length=15)
    compuertas_fallidas: list[CompuertaIA] | None = Field(default=None, max_length=9)
    ubicacion_fuente: Literal["qr", "confirmada", "selector"] | None = None

    @field_validator("campos_autollenados", "campos_editados_por_usuario", "compuertas_fallidas")
    @classmethod
    def _listas_unicas(cls, valores: list[str] | None):
        return None if valores is None else _sin_repetidos(valores)


EventoIACliente = Literal["deshecho", "editado", "fallback"]
MotivoEventoIA = Literal["usuario_deshizo", "usuario_edito", "continuo_manual"]


class EventoIAIn(BaseModel):
    """Únicos datos que el navegador puede declarar sobre una oferta emitida por el servidor."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    analisis_id: str = Field(pattern=PatronIdentificadorAnalisis)
    evento: EventoIACliente
    motivo: MotivoEventoIA | None = None

    @model_validator(mode="after")
    def _motivo_coherente(self) -> Self:
        esperados = {
            "deshecho": "usuario_deshizo",
            "editado": "usuario_edito",
            "fallback": "continuo_manual",
        }
        if self.motivo is not None and self.motivo != esperados[self.evento]:
            raise ValueError("El motivo no corresponde al tipo de evento")
        return self


class EventoIAOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    analisis_id: str = Field(pattern=PatronIdentificadorAnalisis)
    evento: EventoIACliente
    registrado: bool
    es_final: bool


class OfertaIAInterna(IASugerencia):
    """Entrada exclusiva de servicios confiables; nunca se recibe directamente por HTTP."""

    categoria: str | None = Field(default=None, min_length=3, max_length=30, pattern=r"^[a-z][a-z0-9_]*$")
    latencia_ia_ms: int | None = Field(default=None, ge=0, le=300_000)
    tokens_entrada: int | None = Field(default=None, ge=0)
    tokens_salida: int | None = Field(default=None, ge=0)
    costo_estimado_usd: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    resultado_ia: Literal["ok", "error", "timeout"] | None = None
