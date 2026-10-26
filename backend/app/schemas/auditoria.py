"""Contratos de salida de la bitácora administrativa."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

RecursoAuditoria = Literal["usuarios", "roles", "categorias"]
AccionAuditoria = Literal["crear", "editar"]


class ResumenAuditoriaOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rol: str | None = None
    activo: bool | None = None
    areas: list[str] | None = None
    edificios: list[str] | None = None
    tipo_reportante: str | None = None
    clave: str | None = None
    alcance: str | None = None
    cantidad_permisos: int | None = None
    version: int | None = None
    prefijo: str | None = None
    cantidad_campos: int | None = None
    sistema: bool | None = None


class EventoAuditoriaOut(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str = Field(alias="_id")
    actor_id: str
    accion: AccionAuditoria
    recurso: RecursoAuditoria
    recurso_id: str
    antes: ResumenAuditoriaOut | None = None
    despues: ResumenAuditoriaOut
    fecha: str


class PaginaAuditoriaOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pagina: int
    limite: int
    total: int
    resultados: list[EventoAuditoriaOut]
