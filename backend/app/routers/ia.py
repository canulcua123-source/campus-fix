from typing import Annotated

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from redis.exceptions import RedisError

from datetime import datetime, timezone
import re

from app.core.db import get_redis
from app.core.security import require_permiso
from app.schemas.ia import AnalisisImagen
from app.services.config_ia import ConfiguracionIANoDisponible, obtener_config_ia
from app.services.ia import IAError, analizar_imagen

router = APIRouter(prefix="/ia", tags=["ia"])

TIPOS_PERMITIDOS = {"image/jpeg", "image/png", "image/webp"}
MAX_BYTES = 5 * 1024 * 1024


def _minimizar_contexto(contexto: str | None, usuario: dict) -> str | None:
    """Conserva solo el texto necesario y elimina datos del perfil autenticado."""
    if contexto is None:
        return None
    limpio = contexto
    for campo in ("nombre", "correo"):
        valor = usuario.get(campo)
        if isinstance(valor, str) and valor:
            limpio = re.sub(re.escape(valor), "[dato omitido]", limpio, flags=re.IGNORECASE)
    return limpio


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
    try:
        config = await obtener_config_ia()
    except ConfiguracionIANoDisponible as exc:
        raise HTTPException(503, "La configuración de IA no está disponible") from exc
    if not config.habilitada:
        raise HTTPException(503, "El análisis con IA está deshabilitado")
    try:
        # Cupo diario por usuario: cada análisis tiene costo.
        clave = f"ia:uso:{usuario['_id']}:{datetime.now(timezone.utc):%Y-%m-%d}"
        usos = await get_redis().incr(clave)
        await get_redis().expire(clave, 2 * 24 * 3600)
        if usos > config.limite_diario_usuario:
            raise HTTPException(429, f"Alcanzaste el límite de {config.limite_diario_usuario} análisis por día")
        clave_global = f"ia:uso:global:{datetime.now(timezone.utc):%Y-%m-%d}"
        if await get_redis().incr(clave_global) > config.limite_diario_global:
            raise HTTPException(503, "El análisis con IA no está disponible por hoy")
        await get_redis().expire(clave_global, 2 * 24 * 3600)
    except RedisError as exc:
        raise HTTPException(503, "El análisis con IA no está disponible por ahora") from exc
    try:
        # Lista de datos permitidos para el proveedor: imagen, MIME y contexto minimizado.
        return await analizar_imagen(datos, imagen.content_type, _minimizar_contexto(contexto, usuario))
    except Exception as e:  # IAError, errores de red/API, JSON inválido
        raise HTTPException(503, "No fue posible analizar la imagen con IA") from e


__all__ = ["router", "IAError"]
