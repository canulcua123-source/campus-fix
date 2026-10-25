import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.core.db import get_db, get_redis
from app.core.limiter import LIMITE_LOGIN, limiter
from slowapi.util import get_remote_address
from app.core.security import (
    HASH_FICTICIO,
    crear_access_token,
    get_usuario_actual,
    permisos_del_usuario,
    verificar_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])
MAX_FALLOS_IP = 10  # por cuenta y por IP: un atacante no bloquea al dueño desde otra red
MAX_FALLOS_CUENTA = 50  # por cuenta desde cualquier IP: frena fuerza bruta distribuida
VENTANA_FALLOS = 15 * 60


class LoginIn(BaseModel):
    correo: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)


@router.post("/login")
@limiter.limit(LIMITE_LOGIN)
async def login(request: Request, datos: LoginIn):
    correo = datos.correo.strip().lower()
    # Además del límite general por IP: intentos fallidos por (cuenta, IP) y por cuenta.
    clave_ip = f"login:fallos:{correo}:{get_remote_address(request)}"
    clave_cuenta = f"login:fallos:{correo}"
    redis = get_redis()
    if (
        int(await redis.get(clave_ip) or 0) >= MAX_FALLOS_IP
        or int(await redis.get(clave_cuenta) or 0) >= MAX_FALLOS_CUENTA
    ):
        raise HTTPException(429, "Demasiados intentos fallidos; espera 15 minutos")
    usuario = await get_db().usuarios.find_one({"correo": correo})
    # Se verifica siempre contra un hash (real o ficticio) para no revelar por tiempo si el correo existe.
    # argon2 es costoso: corre en un hilo para no bloquear el event loop.
    hash_ = usuario["password_hash"] if usuario else HASH_FICTICIO
    valido = await asyncio.to_thread(verificar_password, datos.password, hash_)
    if usuario is None or not valido or usuario.get("activo") is False:
        for clave in (clave_ip, clave_cuenta):
            await redis.incr(clave)
            await redis.expire(clave, VENTANA_FALLOS)
        raise HTTPException(401, "Credenciales inválidas")
    await redis.delete(clave_ip)
    info = await permisos_del_usuario(usuario)
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


@router.get("/me")
async def yo(usuario: Annotated[dict, Depends(get_usuario_actual)]):
    info = await permisos_del_usuario(usuario)
    datos = {
        k: usuario[k] for k in ("nombre", "correo", "rol", "areas", "edificios", "tipo_reportante") if k in usuario
    }
    return {"_id": str(usuario["_id"]), **datos, "permisos": info["permisos"], "alcance": info["alcance"]}
