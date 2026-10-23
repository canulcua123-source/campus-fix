from typing import Annotated

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile

from datetime import datetime, timezone

from app.core.config import settings
from app.core.db import get_redis
from app.core.imagen import (
    FormatoImagenNoPermitido,
    ImagenDemasiadoGrande,
    ImagenNoProcesable,
    leer_y_validar_imagen,
)
from app.core.security import require_permiso
from app.schemas.ia import AnalisisImagen
from app.services.ia import IAError, analizar_imagen

router = APIRouter(prefix="/ia", tags=["ia"])


@router.post(
    "/analizar-imagen",
    response_model=AnalisisImagen,
    responses={
        413: {
            "description": "El archivo supera 5 MB",
            "content": {"application/json": {"example": {"detail": "La imagen excede 5 MB"}}},
        },
        415: {
            "description": "El contenido no es JPEG, PNG ni WebP",
            "content": {"application/json": {"example": {"detail": "Formato no permitido (usa JPEG, PNG o WebP)"}}},
        },
        422: {
            "description": "La imagen está corrupta o sus dimensiones están fuera de 200–2600 px",
            "content": {
                "application/json": {
                    "example": {
                        "detail": "La imagen está corrupta o sus dimensiones están fuera del rango permitido (200–2600 px)"
                    }
                }
            },
        },
    },
)
async def analizar(
    imagen: UploadFile,
    usuario: Annotated[dict, Depends(require_permiso("ia:usar"))],
    contexto: Annotated[str | None, Form(max_length=500)] = None,
):
    try:
        validada = await leer_y_validar_imagen(imagen)
    except ImagenDemasiadoGrande as exc:
        raise HTTPException(413, "La imagen excede 5 MB") from exc
    except FormatoImagenNoPermitido as exc:
        raise HTTPException(415, "Formato no permitido (usa JPEG, PNG o WebP)") from exc
    except ImagenNoProcesable as exc:
        raise HTTPException(
            422, "La imagen está corrupta o sus dimensiones están fuera del rango permitido (200–2600 px)"
        ) from exc
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
        return await analizar_imagen(validada.datos, validada.tipo_mime, contexto)
    except Exception as e:  # IAError, errores de red/API, JSON inválido
        raise HTTPException(503, "No fue posible analizar la imagen con IA") from e


__all__ = ["router", "IAError"]
