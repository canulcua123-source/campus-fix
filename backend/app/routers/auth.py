import asyncio
import logging
from datetime import datetime, timezone
from typing import Annotated

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from jwt import PyJWTError
from pydantic import BaseModel, ConfigDict, Field, field_validator
from redis.exceptions import RedisError

from app.core.config import PATRON_CORREO, settings, validar_dominio_correo
from app.core.db import get_db, get_redis
from app.core.errores import cabeceras_retry_after
from app.core.limiter import LIMITE_LOGIN, limiter
from app.core.refresh_tokens import ResultadoRefresh, iniciar_familia, revocar_familia, rotar_token
from app.core.security import (
    HASH_FICTICIO,
    crear_access_token,
    crear_refresh_token,
    decodificar_refresh_token,
    get_usuario_actual,
    permisos_del_usuario,
    verificar_password,
)
from slowapi.util import get_remote_address

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)
MAX_FALLOS_IP = 10  # por cuenta y por IP: un atacante no bloquea al dueño desde otra red
MAX_FALLOS_CUENTA = 50  # por cuenta desde cualquier IP: frena fuerza bruta distribuida
VENTANA_FALLOS = 15 * 60
COOKIE_REFRESH = "refresh_token"
RUTA_COOKIE_REFRESH = "/auth"
# Cuenta sembrada por scripts/init_db.py; queda fuera del dominio institucional a propósito.
CORREO_ADMIN_SEMBRADO = "admin@utm.local"


class LoginIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    correo: str = Field(min_length=3, max_length=254, pattern=PATRON_CORREO)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("correo", mode="before")
    @classmethod
    def _normalizar_correo(cls, v):
        return v.strip().lower() if isinstance(v, str) else v

    @field_validator("correo")
    @classmethod
    def _dominio_institucional(cls, v: str) -> str:
        return validar_dominio_correo(v, permitidos=(CORREO_ADMIN_SEMBRADO,))


def _validar_origen_csrf(request: Request) -> None:
    """Los clientes no navegador pueden omitir Origin; un navegador no puede falsificarlo."""
    origen = request.headers.get("origin")
    if origen is not None and origen not in settings.cors_lista:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Origen no permitido")


def _establecer_cookie_refresh(response: Response, token: str, family_exp: int) -> None:
    ahora = int(datetime.now(timezone.utc).timestamp())
    response.set_cookie(
        key=COOKIE_REFRESH,
        value=token,
        max_age=max(0, family_exp - ahora),
        expires=datetime.fromtimestamp(family_exp, tz=timezone.utc),
        path=RUTA_COOKIE_REFRESH,
        secure=settings.refresh_cookie_secure,
        httponly=True,
        samesite=settings.refresh_cookie_samesite,
    )


def _borrar_cookie_refresh(response: Response) -> None:
    response.delete_cookie(
        COOKIE_REFRESH,
        path=RUTA_COOKIE_REFRESH,
        secure=settings.refresh_cookie_secure,
        httponly=True,
        samesite=settings.refresh_cookie_samesite,
    )


def _leer_refresh(request: Request) -> tuple[str, dict]:
    token = request.cookies.get(COOKIE_REFRESH)
    if token is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sesión inválida o expirada")
    try:
        payload = decodificar_refresh_token(token)
        ObjectId(payload["sub"])
    except (InvalidId, PyJWTError, TypeError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sesión inválida o expirada") from None
    return token, payload


async def _estado_bloqueo(redis, claves: list[str]) -> tuple[bool, int | None]:
    """Devuelve si el bloqueo sigue activo y su TTL fiable, sin alterar contadores."""
    try:
        ttls = [int(await redis.ttl(clave)) for clave in claves]
    except RedisError:
        logger.exception("No fue posible consultar el TTL del bloqueo de autenticación")
        return True, None
    if -1 in ttls:
        logger.error("Un contador de bloqueo de autenticación no tiene expiración")
        return True, None
    activos = [ttl for ttl in ttls if ttl >= 0]
    if not activos:  # -2: todas las claves bloqueantes ya expiraron.
        return False, None
    return True, max(1, max(activos))


@router.post("/login")
@limiter.limit(LIMITE_LOGIN)
async def login(request: Request, datos: LoginIn, response: Response = None):
    correo = datos.correo.strip().lower()
    # Además del límite general por IP: intentos fallidos por (cuenta, IP) y por cuenta.
    clave_ip = f"login:fallos:{correo}:{get_remote_address(request)}"
    clave_cuenta = f"login:fallos:{correo}"
    redis = get_redis()
    fallos_ip = int(await redis.get(clave_ip) or 0)
    fallos_cuenta = int(await redis.get(clave_cuenta) or 0)
    claves_bloqueadas = []
    if fallos_ip >= MAX_FALLOS_IP:
        claves_bloqueadas.append(clave_ip)
    if fallos_cuenta >= MAX_FALLOS_CUENTA:
        claves_bloqueadas.append(clave_cuenta)
    if claves_bloqueadas:
        bloqueado, segundos = await _estado_bloqueo(redis, claves_bloqueadas)
        if bloqueado:
            raise HTTPException(
                429,
                "Demasiados intentos fallidos; espera 15 minutos",
                headers=cabeceras_retry_after(segundos),
            )
    usuario = await get_db().usuarios.find_one({"correo": correo})
    # Se verifica siempre contra un hash (real o ficticio) para no revelar por tiempo si el correo existe.
    # argon2 es costoso: corre en un hilo para no bloquear el event loop.
    hash_ = usuario["password_hash"] if usuario else HASH_FICTICIO
    valido = await asyncio.to_thread(verificar_password, datos.password, hash_)
    if usuario is None or not valido or usuario.get("activo") is not True:
        for clave in (clave_ip, clave_cuenta):
            await redis.incr(clave)
            await redis.expire(clave, VENTANA_FALLOS)
        raise HTTPException(401, "Credenciales inválidas")
    await redis.delete(clave_ip)
    info = await permisos_del_usuario(usuario)
    refresh, claims = crear_refresh_token(str(usuario["_id"]))
    resultado = await iniciar_familia(
        redis,
        sub=claims["sub"],
        jti=claims["jti"],
        family_id=claims["family_id"],
        family_exp=claims["family_exp"],
    )
    if resultado != ResultadoRefresh.OK:
        logger.error("No fue posible crear una familia de refresh token")
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "El servicio no está disponible temporalmente")
    if response is not None:
        _establecer_cookie_refresh(response, refresh, claims["family_exp"])
    return {
        "access_token": crear_access_token(str(usuario["_id"])),
        "token_type": "bearer",
        "usuario": {
            "nombre": usuario["nombre"],
            "rol": usuario["rol"],
            "permisos": info["permisos"],
            "alcance": info["alcance"],
        },
    }


@router.post("/refresh")
@limiter.limit(lambda: settings.limite_refresh)
async def renovar_sesion(request: Request, response: Response):
    _validar_origen_csrf(request)
    _, claims = _leer_refresh(request)
    usuario = await get_db().usuarios.find_one({"_id": ObjectId(claims["sub"]), "activo": True})
    if usuario is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sesión inválida o expirada")

    expiracion_familia = datetime.fromtimestamp(claims["family_exp"], tz=timezone.utc)
    refresh_nuevo, claims_nuevos = crear_refresh_token(
        claims["sub"],
        family_id=claims["family_id"],
        expira_en=expiracion_familia,
    )
    resultado = await rotar_token(
        get_redis(),
        sub=claims["sub"],
        jti_anterior=claims["jti"],
        jti_nuevo=claims_nuevos["jti"],
        family_id=claims["family_id"],
        family_exp=claims["family_exp"],
    )
    if resultado != ResultadoRefresh.OK:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sesión inválida o expirada")

    _establecer_cookie_refresh(response, refresh_nuevo, claims["family_exp"])
    return {"access_token": crear_access_token(claims["sub"]), "token_type": "bearer"}


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def cerrar_sesion(request: Request):
    _validar_origen_csrf(request)
    token = request.cookies.get(COOKIE_REFRESH)
    if token is not None:
        try:
            claims = decodificar_refresh_token(token)
            ObjectId(claims["sub"])
        except (InvalidId, PyJWTError, TypeError, ValueError):
            claims = None
        if claims is not None:
            await revocar_familia(
                get_redis(),
                sub=claims["sub"],
                jti=claims["jti"],
                family_id=claims["family_id"],
            )
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    _borrar_cookie_refresh(response)
    return response


@router.get("/me")
async def yo(usuario: Annotated[dict, Depends(get_usuario_actual)]):
    info = await permisos_del_usuario(usuario)
    datos = {
        k: usuario[k] for k in ("nombre", "correo", "rol", "areas", "edificios", "tipo_reportante") if k in usuario
    }
    return {"_id": str(usuario["_id"]), **datos, "permisos": info["permisos"], "alcance": info["alcance"]}
