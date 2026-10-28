"""Centro de control del superadmin: salud del sistema y resumen operativo (GET /sistema/*)."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

EstadoComponente = Literal["ok", "advertencia", "error"]


class ComponenteSalud(BaseModel):
    model_config = ConfigDict(extra="forbid")

    estado: EstadoComponente
    detalle: str = Field(max_length=200)
    latencia_ms: float | None = Field(default=None, ge=0)


class SaludIA(ComponenteSalud):
    habilitada: bool
    proveedor: str
    modelo: str
    usados_hoy: int | None = Field(default=None, ge=0)
    limite_diario: int | None = Field(default=None, ge=1)
    porcentaje_cupo: float | None = Field(default=None, ge=0)


class SaludSistema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    estado: Literal["ok", "degradado", "caido"]
    version: str
    uptime_segundos: int = Field(ge=0)
    fecha: str
    mongo: ComponenteSalud
    redis: ComponenteSalud
    almacenamiento: ComponenteSalud
    ia: SaludIA


class KpisSistema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    abiertas: int = Field(ge=0, description="Activas: abierta, en proceso o en espera")
    criticas_sin_asignar: int = Field(ge=0)
    vencidas: int = Field(ge=0, description="Activas con más de 24 h desde su creación")
    resueltas_hoy: int = Field(ge=0)
    resueltas_semana: int = Field(ge=0)
    horas_resolucion_prom: float | None = Field(default=None, ge=0, description="Últimos 30 días")


class AlertaSistema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tipo: Literal["criticas_sin_asignar", "vencidas", "carga_tecnicos", "cupo_ia"]
    severidad: Literal["critica", "advertencia"]
    titulo: str
    detalle: str
    total: int = Field(ge=0)
    enlace: str


class ConteoClave(BaseModel):
    model_config = ConfigDict(extra="forbid")

    clave: str
    total: int = Field(ge=0)


class CargaTecnicoNombre(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tecnico_id: str = Field(pattern=r"^[0-9a-f]{24}$")
    nombre: str
    incidencias_activas: int = Field(ge=1)
    horas_acumuladas: float = Field(ge=0, allow_inf_nan=False)


class ResumenSistema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kpis: KpisSistema
    alertas: list[AlertaSistema]
    top_edificios: list[ConteoClave]
    top_categorias: list[ConteoClave]
    carga_tecnicos: list[CargaTecnicoNombre]
