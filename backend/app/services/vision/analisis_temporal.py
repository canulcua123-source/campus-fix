from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.ia import RespuestaIA
from app.services.vision.compuertas import ResultadoCompuerta

ANALISIS_TTL = 30 * 60
NAMESPACE_ANALISIS = "ia:analisis:v1"


class RegistroAnalisis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal["v1"] = "v1"
    usuario_id: str
    imagen_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    respuesta: RespuestaIA
    compuertas: tuple[ResultadoCompuerta, ...]
    prompt_version: str
    creado_en: datetime


def clave_analisis(analisis_id: UUID | str) -> str:
    return f"{NAMESPACE_ANALISIS}:{analisis_id}"


async def guardar_analisis(redis, registro: RegistroAnalisis) -> None:
    """Guarda valor y expiración en una sola operación Redis."""
    guardado = await redis.set(
        clave_analisis(registro.respuesta.analisis_id),
        registro.model_dump_json(),
        ex=ANALISIS_TTL,
    )
    if not guardado:
        raise RuntimeError("Redis no confirmó el almacenamiento temporal")


async def cargar_analisis(redis, analisis_id: UUID, usuario_id: str) -> RegistroAnalisis | None:
    """Lee sin renovar TTL y oculta inexistencia, expiración o propietario distinto."""
    crudo = await redis.get(clave_analisis(analisis_id))
    if crudo is None:
        return None
    try:
        registro = RegistroAnalisis.model_validate_json(crudo)
    except ValueError:
        return None
    if registro.usuario_id != usuario_id:
        return None
    return registro
