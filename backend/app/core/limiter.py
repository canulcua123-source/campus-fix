import logging

from fastapi import HTTPException
from jwt import PyJWTError
from limits import parse
from limits.errors import StorageError
from redis.exceptions import RedisError
from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

from app.core.config import settings
from app.core.errores import cabeceras_retry_after, segundos_hasta_reinicio

logger = logging.getLogger(__name__)

LIMITE_LOGIN = "10/minute"


def clave_usuario(request: Request) -> str:
    """Endpoints autenticados: cuenta por usuario (sub del JWT); sin token válido, por IP.

    Así un usuario no agota el cupo de todos los que comparten su IP (NAT del campus)."""
    from app.core.security import decodificar_token  # import diferido: evita ciclo config→security

    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        try:
            return f"usuario:{decodificar_token(auth[7:])['sub']}"
        except (KeyError, TypeError, PyJWTError):
            return f"ip:{get_remote_address(request)}"
    return f"ip:{get_remote_address(request)}"


# Contadores en Redis: se comparten entre workers y sobreviven reinicios.
# Detrás de un proxy, uvicorn debe arrancar con --proxy-headers y --forwarded-allow-ips=<IP del proxy>.
limiter = Limiter(key_func=clave_usuario, storage_uri=settings.redis_url)


async def limite_general(request: Request) -> None:
    """Límite global por usuario (o IP sin token) para TODOS los endpoints; se registra en FastAPI(dependencies=...).

    No se usa SlowAPIMiddleware/default_limits: no reconoce las rutas de los routers incluidos y las dejaría sin límite.
    """
    if request.url.path == "/health":
        return
    limite = parse(settings.limite_general)
    clave = clave_usuario(request)
    if limiter.limiter.hit(limite, "general", clave):
        return
    try:
        reinicio, _ = limiter.limiter.get_window_stats(limite, "general", clave)
        segundos = segundos_hasta_reinicio(reinicio)
    except (RedisError, StorageError):
        logger.exception("No fue posible consultar la ventana del límite global")
        segundos = None
    raise HTTPException(
        429,
        "Demasiadas peticiones; espera un momento",
        headers=cabeceras_retry_after(segundos),
    )
