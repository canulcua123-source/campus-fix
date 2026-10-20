from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

from app.core.config import settings


def clave_usuario(request: Request) -> str:
    """Endpoints autenticados: cuenta por usuario (sub del JWT); sin token válido, por IP.

    Así un usuario no agota el cupo de todos los que comparten su IP (NAT del campus)."""
    from app.core.security import decodificar_token  # import diferido: evita ciclo config→security

    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        try:
            return f"usuario:{decodificar_token(auth[7:])['sub']}"
        except Exception:
            pass
    return f"ip:{get_remote_address(request)}"


# Contadores en Redis: se comparten entre workers y sobreviven reinicios.
# Detrás de un proxy, uvicorn debe arrancar con --proxy-headers y --forwarded-allow-ips=<IP del proxy>.
limiter = Limiter(key_func=get_remote_address, storage_uri=settings.redis_url)
