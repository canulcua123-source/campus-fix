import hashlib
import json
import logging
import unicodedata
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile

from app.core.config import settings
from app.core.db import get_redis
from app.core.security import require_permiso
from app.schemas.ia import AnalisisImagen, RespuestaAnalisisImagen
from app.services.ia import IAError, PROMPT_VERSION, PROVEEDOR_IA, analizar_imagen

router = APIRouter(prefix="/ia", tags=["ia"])
logger = logging.getLogger(__name__)

TIPOS_PERMITIDOS = {"image/jpeg", "image/png", "image/webp"}
MAX_BYTES = 5 * 1024 * 1024
CACHE_TTL = 24 * 3600
CUPO_TTL = 2 * 24 * 3600

_CONSUMIR_CUPO = """
local uso_usuario = tonumber(redis.call('GET', KEYS[1]) or '0')
if uso_usuario >= tonumber(ARGV[1]) then
    return {0, uso_usuario}
end
local uso_global = tonumber(redis.call('GET', KEYS[2]) or '0')
if uso_global >= tonumber(ARGV[2]) then
    return {-1, uso_global}
end
uso_usuario = redis.call('INCR', KEYS[1])
uso_global = redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[1], ARGV[3])
redis.call('EXPIRE', KEYS[2], ARGV[3])
return {1, uso_usuario, uso_global}
"""

_DEVOLVER_CUPO = """
for i = 1, 2 do
    local uso = tonumber(redis.call('GET', KEYS[i]) or '0')
    if uso > 0 then redis.call('DECR', KEYS[i]) end
end
return 1
"""


def _normalizar_contexto(contexto: str | None) -> str:
    if not contexto:
        return ""
    return " ".join(unicodedata.normalize("NFKC", contexto).split())


def _clave_cache(datos: bytes, contexto: str | None, *, prompt_version: str, proveedor: str, modelo: str) -> str:
    componentes = {
        "imagen_sha256": hashlib.sha256(datos).hexdigest(),
        "pistas": {"contexto": _normalizar_contexto(contexto)},
        "prompt_version": prompt_version,
        "proveedor": proveedor,
        "modelo": modelo,
    }
    serializado = json.dumps(componentes, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return f"ia:cache:{hashlib.sha256(serializado.encode()).hexdigest()}"


def _claves_cupo(usuario_id: object, ahora: datetime) -> tuple[str, str]:
    dia = f"{ahora:%Y-%m-%d}"
    return f"ia:uso:{usuario_id}:{dia}", f"ia:uso:global:{dia}"


async def _consumir_cupo(redis, claves: tuple[str, str]) -> None:
    resultado = await redis.eval(
        _CONSUMIR_CUPO,
        2,
        *claves,
        settings.ia_limite_diario,
        settings.ia_limite_global_diario,
        CUPO_TTL,
    )
    estado = int(resultado[0])
    if estado == 0:
        raise HTTPException(429, f"Alcanzaste el límite de {settings.ia_limite_diario} análisis por día")
    if estado == -1:
        raise HTTPException(503, "El análisis con IA no está disponible por hoy")


def _respuesta(analisis: AnalisisImagen, *, cache: bool) -> RespuestaAnalisisImagen:
    return RespuestaAnalisisImagen(**analisis.model_dump(), cache=cache)


@router.post("/analizar-imagen", response_model=RespuestaAnalisisImagen)
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

    contexto_normalizado = _normalizar_contexto(contexto)
    clave_cache = _clave_cache(
        datos,
        contexto_normalizado,
        prompt_version=PROMPT_VERSION,
        proveedor=PROVEEDOR_IA,
        modelo=settings.ia_modelo,
    )
    redis = None
    try:
        redis = get_redis()
        guardado = await redis.get(clave_cache)
        if guardado is not None:
            try:
                return _respuesta(AnalisisImagen.model_validate_json(guardado), cache=True)
            except ValueError:
                logger.warning("Entrada inválida en la caché de IA; se regenerará", exc_info=True)
    except Exception:
        logger.warning("Redis no disponible al consultar la caché de IA", exc_info=True)
        redis = None

    claves_cupo = _claves_cupo(usuario["_id"], datetime.now(timezone.utc))
    cupo_consumido = False
    if redis is not None:
        try:
            await _consumir_cupo(redis, claves_cupo)
            cupo_consumido = True
        except HTTPException:
            raise
        except Exception:
            logger.warning("Redis no disponible al consumir el cupo de IA", exc_info=True)
            redis = None

    try:
        analisis = await analizar_imagen(datos, imagen.content_type, contexto_normalizado or None)
    except Exception as e:  # IAError, errores de red/API, JSON inválido
        if cupo_consumido:
            try:
                await redis.eval(_DEVOLVER_CUPO, 2, *claves_cupo)
            except Exception:
                logger.error("No se pudo devolver el cupo tras un fallo del proveedor de IA", exc_info=True)
        raise HTTPException(503, "No fue posible analizar la imagen con IA") from e

    if redis is not None:
        try:
            await redis.set(clave_cache, analisis.model_dump_json(), ex=CACHE_TTL)
        except Exception:
            logger.warning("Redis no disponible al guardar la caché de IA", exc_info=True)
    return _respuesta(analisis, cache=False)


__all__ = ["router", "IAError"]
