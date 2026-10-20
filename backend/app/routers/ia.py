from typing import Annotated

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile

from datetime import datetime, timezone

from app.core.config import settings
from app.core.db import get_redis
from app.core.security import require_permiso
from app.schemas.ia import AnalisisImagen
from app.services.ia import IAError, analizar_imagen

router = APIRouter(prefix="/ia", tags=["ia"])

TIPOS_PERMITIDOS = {"image/jpeg", "image/png", "image/webp"}
MAX_BYTES = 5 * 1024 * 1024


@router.post("/analizar-imagen", response_model=AnalisisImagen)
async def analizar(
    imagen: UploadFile,
    usuario: Annotated[dict, Depends(require_permiso("ia:usar"))],
    contexto: Annotated[str | None, Form(max_length=500)] = None,
):
    if imagen.content_type not in TIPOS_PERMITIDOS:
        raise HTTPException(400, "Formato no permitido (usa JPEG, PNG o WebP)")
    datos = await imagen.read(MAX_BYTES + 1)
    if len(datos) > MAX_BYTES:
        raise HTTPException(400, "La imagen excede 5 MB")
    if not settings.ia_habilitada:
        raise HTTPException(503, "El análisis con IA está deshabilitado")
    # Cupo diario por usuario: cada análisis tiene costo.
    clave = f"ia:uso:{usuario['_id']}:{datetime.now(timezone.utc):%Y-%m-%d}"
    usos = await get_redis().incr(clave)
    await get_redis().expire(clave, 2 * 24 * 3600)
    if usos > settings.ia_limite_diario:
        raise HTTPException(429, f"Alcanzaste el límite de {settings.ia_limite_diario} análisis por día")
    clave_global = f"ia:uso:global:{datetime.now(timezone.utc):%Y-%m-%d}"
    if await get_redis().incr(clave_global) > settings.ia_limite_global_diario:
        raise HTTPException(503, "El análisis con IA no está disponible por hoy")
    await get_redis().expire(clave_global, 2 * 24 * 3600)
    try:
        return await analizar_imagen(datos, imagen.content_type, contexto)
    except Exception as e:  # IAError, errores de red/API, JSON inválido
        raise HTTPException(503, "No fue posible analizar la imagen con IA") from e


__all__ = ["router", "IAError"]
