"""Contratos de entrada y salida para los endpoints de analítica."""

import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Annotated, Literal, Self

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, model_validator

CategoriaAnalitica = Literal["computo_redes", "infraestructura", "academico"]
_FECHA_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _fecha_calendario(valor: object) -> date:
    """Acepta solo fechas calendario ISO, sin instantes ni zonas horarias ambiguas."""
    if isinstance(valor, datetime):
        raise ValueError("Debe ser una fecha de calendario AAAA-MM-DD")
    if isinstance(valor, date):
        return valor
    if not isinstance(valor, str) or _FECHA_ISO.fullmatch(valor) is None:
        raise ValueError("Debe ser una fecha de calendario AAAA-MM-DD")
    try:
        return date.fromisoformat(valor)
    except ValueError as exc:
        raise ValueError("La fecha de calendario no existe") from exc


FechaCalendario = Annotated[date, BeforeValidator(_fecha_calendario)]


class FiltrosAnalitica(BaseModel):
    model_config = ConfigDict(extra="forbid")

    desde: FechaCalendario | None = Field(default=None, description="Primer día incluido, en UTC (AAAA-MM-DD)")
    hasta: FechaCalendario | None = Field(default=None, description="Último día incluido, en UTC (AAAA-MM-DD)")
    categoria: CategoriaAnalitica | None = None

    @model_validator(mode="after")
    def _periodo_valido(self) -> Self:
        if self.desde is not None and self.hasta is not None and self.desde > self.hasta:
            raise ValueError("desde no puede ser posterior a hasta")
        if self.hasta == date.max:
            raise ValueError("hasta está fuera del intervalo admitido")
        return self

    def intervalo_utc(self) -> tuple[datetime | None, datetime | None]:
        """Devuelve [desde, día posterior a hasta) para incluir completo el límite superior."""
        inicio = datetime.combine(self.desde, time.min, tzinfo=timezone.utc) if self.desde else None
        fin = (
            datetime.combine(self.hasta + timedelta(days=1), time.min, tzinfo=timezone.utc)
            if self.hasta
            else None
        )
        return inicio, fin

    def para_cache(self) -> dict[str, str | None]:
        return {
            "desde": self.desde.isoformat() if self.desde else None,
            "hasta": self.hasta.isoformat() if self.hasta else None,
            "categoria": self.categoria,
        }


class ResumenAnalitica(BaseModel):
    model_config = ConfigDict(extra="forbid")

    abiertas: int = Field(ge=0)
    en_proceso: int = Field(ge=0)
    criticas: int = Field(ge=0)
    resueltas_periodo: int = Field(ge=0)


class AnaliticaEdificio(BaseModel):
    model_config = ConfigDict(extra="forbid")

    edificio: str = Field(min_length=1, max_length=60)
    total: int = Field(ge=0)
    horas_invertidas: float = Field(ge=0)
    horas_resolucion_prom: float | None = Field(default=None, ge=0)


class AnaliticaTag(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tag: str = Field(min_length=2, max_length=30)
    total: int = Field(ge=0)


class AulaCronica(BaseModel):
    model_config = ConfigDict(extra="forbid")

    edificio: str = Field(min_length=1, max_length=60)
    piso: int | None = Field(default=None, ge=-5, le=50)
    aula: str = Field(min_length=1, max_length=60)
    total: int = Field(ge=3)


class CargaTecnico(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tecnico_id: str = Field(pattern=r"^[0-9a-f]{24}$")
    incidencias_activas: int = Field(ge=1)
    horas_acumuladas: float = Field(ge=0, allow_inf_nan=False)


class TendenciaMensual(BaseModel):
    model_config = ConfigDict(extra="forbid")

    periodo: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    categoria: CategoriaAnalitica
    total: int = Field(ge=1)


class FiltrosMetricasIA(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    desde: FechaCalendario | None = None
    hasta: FechaCalendario | None = None
    categoria: str | None = Field(default=None, min_length=3, max_length=30, pattern=r"^[a-z][a-z0-9_]*$")
    proveedor: str | None = Field(default=None, min_length=2, max_length=30, pattern=r"^[a-z][a-z0-9_-]+$")
    modelo: str | None = Field(default=None, min_length=1, max_length=100, pattern=r"^[A-Za-z0-9._:/-]+$")

    @model_validator(mode="after")
    def _periodo_valido(self) -> Self:
        if self.desde is not None and self.hasta is not None:
            if self.desde > self.hasta:
                raise ValueError("desde no puede ser posterior a hasta")
            if (self.hasta - self.desde).days > 179:
                raise ValueError("El periodo máximo de métricas de IA es de 180 días")
        if self.hasta == date.max:
            raise ValueError("hasta está fuera del intervalo admitido")
        return self

    def intervalo_utc(self, ahora: datetime | None = None) -> tuple[datetime, datetime]:
        instante = (ahora or datetime.now(timezone.utc)).astimezone(timezone.utc)
        fin = (
            datetime.combine(self.hasta + timedelta(days=1), time.min, tzinfo=timezone.utc)
            if self.hasta
            else instante
        )
        inicio = (
            datetime.combine(self.desde, time.min, tzinfo=timezone.utc)
            if self.desde
            else fin - timedelta(days=30)
        )
        if fin - inicio > timedelta(days=180):
            inicio = fin - timedelta(days=180)
        return inicio, fin

    def para_cache(self) -> dict[str, str | None]:
        return {
            "desde": self.desde.isoformat() if self.desde else None,
            "hasta": self.hasta.isoformat() if self.hasta else None,
            "categoria": self.categoria,
            "proveedor": self.proveedor,
            "modelo": self.modelo,
        }


class PeriodoMetricasIA(BaseModel):
    model_config = ConfigDict(extra="forbid")

    desde: datetime
    hasta: datetime


class TotalesMetricasIA(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ofertas: int = Field(ge=0)
    editadas: int = Field(ge=0)
    deshechas: int = Field(ge=0)
    enviadas: int = Field(ge=0)
    duplicados_sumados: int = Field(ge=0)
    fallback: int = Field(ge=0)


class TasaMetricasIA(BaseModel):
    model_config = ConfigDict(extra="forbid")

    numerador: int = Field(ge=0)
    denominador: int = Field(ge=0)
    porcentaje: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    disponible: bool = True
    motivo: str | None = Field(default=None, min_length=1, max_length=240)


class DuracionMetricasIA(BaseModel):
    model_config = ConfigDict(extra="forbid")

    muestras: int = Field(ge=0)
    promedio_ms: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    p50_ms: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    p95_ms: float | None = Field(default=None, ge=0, allow_inf_nan=False)


class CompuertaFallidaIA(BaseModel):
    model_config = ConfigDict(extra="forbid")

    compuerta: Literal["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9"]
    total: int = Field(ge=1)


class CostoDiarioIA(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fecha: date
    costo_estimado_usd: float = Field(ge=0, allow_inf_nan=False)
    llamadas_con_costo: int = Field(ge=1)


class CostoAgrupadoIA(BaseModel):
    model_config = ConfigDict(extra="forbid")

    clave: str = Field(min_length=1, max_length=100)
    costo_estimado_usd: float = Field(ge=0, allow_inf_nan=False)
    llamadas_con_costo: int = Field(ge=1)


class AlertaCostoIA(BaseModel):
    model_config = ConfigDict(extra="forbid")

    configurada: bool
    activa: bool
    umbral_diario_usd: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    dias_excedidos: list[date]


class CostosMetricasIA(BaseModel):
    model_config = ConfigDict(extra="forbid")

    costo_estimado_periodo_usd: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    llamadas_con_costo: int = Field(ge=0)
    tokens_entrada: int | None = Field(default=None, ge=0)
    tokens_salida: int | None = Field(default=None, ge=0)
    diario: list[CostoDiarioIA]
    por_proveedor: list[CostoAgrupadoIA]
    por_modelo: list[CostoAgrupadoIA]
    alerta: AlertaCostoIA


class ResumenSemanalIA(BaseModel):
    model_config = ConfigDict(extra="forbid")

    semana: date
    ofertas: int = Field(ge=0)
    deshechas: int = Field(ge=0)
    editadas: int = Field(ge=0)
    costo_estimado_usd: float | None = Field(default=None, ge=0, allow_inf_nan=False)


class MetricasIAOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    periodo: PeriodoMetricasIA
    totales: TotalesMetricasIA
    tasa_deshacer: TasaMetricasIA
    tasa_edicion: TasaMetricasIA
    correccion_tecnica_72h: TasaMetricasIA
    cobertura_agentica: TasaMetricasIA
    tiempo_toque_folio: DuracionMetricasIA
    compuertas_fallidas: list[CompuertaFallidaIA]
    latencia_ia: DuracionMetricasIA
    errores_ia: int = Field(ge=0)
    timeouts_ia: int = Field(ge=0)
    costos: CostosMetricasIA
    semanal: list[ResumenSemanalIA]
