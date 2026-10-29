from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Final
from uuid import uuid4

import jwt
from bson import ObjectId
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pwdlib import PasswordHash

from app.core.config import settings
from app.core.db import get_db

_hasher = PasswordHash.recommended()  # argon2
_bearer = HTTPBearer(auto_error=False)
ALGORITMO: Final = "HS256"
EMISOR: Final = "utm-desk"
AUDIENCIA: Final = "utm-desk-api"
TIPO_ACCESS: Final = "access"
TIPO_REFRESH: Final = "refresh"
CLAIMS_OBLIGATORIOS: Final = frozenset({"sub", "iss", "aud", "iat", "exp"})
# Hash de una contraseña aleatoria: el login lo verifica cuando el correo no existe (tiempo constante).
HASH_FICTICIO = _hasher.hash("utm-desk-hash-ficticio-para-tiempo-constante")


def hashear_password(password: str) -> str:
    return _hasher.hash(password)


def verificar_password(password: str, hash_: str) -> bool:
    return _hasher.verify(password, hash_)


def crear_access_token(sub: str, extra: dict[str, Any] | None = None) -> str:
    if extra and CLAIMS_OBLIGATORIOS.intersection(extra):
        raise ValueError("Los claims obligatorios del access token no se pueden sobrescribir")
    ahora = datetime.now(timezone.utc)
    payload = {
        **(extra or {}),
        "sub": sub,
        "iss": EMISOR,
        "aud": AUDIENCIA,
        "iat": ahora,
        "exp": ahora + timedelta(minutes=settings.jwt_access_minutes),
        "type": TIPO_ACCESS,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITMO)


def crear_refresh_token(
    sub: str,
    family_id: str | None = None,
    expira_en: datetime | None = None,
) -> tuple[str, dict[str, Any]]:
    ahora = datetime.now(timezone.utc)
    expiracion = expira_en or ahora + timedelta(days=settings.jwt_refresh_days)
    payload = {
        "sub": sub,
        "jti": uuid4().hex,
        "type": TIPO_REFRESH,
        "family_id": family_id or uuid4().hex,
        "family_exp": int(expiracion.timestamp()),
        "iss": EMISOR,
        "aud": AUDIENCIA,
        "iat": ahora,
        "exp": expiracion,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITMO), payload


def _decodificar(token: str, requeridos: list[str]) -> dict[str, Any]:
    return jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=[ALGORITMO],
        audience=AUDIENCIA,
        issuer=EMISOR,
        options={"require": requeridos},
    )


def decodificar_token(token: str) -> dict[str, Any]:
    """Decodifica access tokens; acepta los access antiguos sin `type`."""
    payload = _decodificar(token, sorted(CLAIMS_OBLIGATORIOS))
    if payload.get("type") not in (None, TIPO_ACCESS):
        raise jwt.InvalidTokenError("tipo de token incorrecto")
    return payload


def decodificar_refresh_token(token: str) -> dict[str, Any]:
    payload = _decodificar(
        token,
        ["exp", "iat", "sub", "iss", "aud", "jti", "type", "family_id", "family_exp"],
    )
    if payload.get("type") != TIPO_REFRESH:
        raise jwt.InvalidTokenError("tipo de token incorrecto")
    if not all(isinstance(payload.get(campo), str) and payload[campo] for campo in ("sub", "jti", "family_id")):
        raise jwt.InvalidTokenError("claims de refresh inválidos")
    if not isinstance(payload.get("family_exp"), int) or payload["exp"] != payload["family_exp"]:
        raise jwt.InvalidTokenError("expiración de familia inválida")
    return payload


async def get_usuario_actual(
    cred: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> dict[str, Any]:
    if cred is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "No autenticado")
    try:
        payload = decodificar_token(cred.credentials)
        oid = ObjectId(payload["sub"])
    except Exception:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token inválido o expirado") from None
    usuario = await get_db().usuarios.find_one({"_id": oid, "activo": True})
    if usuario is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuario no encontrado")
    return usuario


async def permisos_del_usuario(usuario: dict[str, Any]) -> dict[str, Any]:
    """Devuelve {"permisos": [...], "alcance": str} del rol del usuario.

    TODO: cachear en Redis (clave `rol:{clave}`, TTL corto) e invalidar al editar roles.
    """
    rol = await get_db().roles.find_one({"clave": usuario.get("rol")})
    if rol is None:
        return {"permisos": [], "alcance": "propio"}
    return {"permisos": rol.get("permisos", []), "alcance": rol.get("alcance", "propio")}


def require_permisos(*permisos: str):
    """Exige TODOS los permisos indicados (AND) y carga permisos y alcance del usuario.

    Para el modo agéntico (T-036, `POST /incidencias/desde-foto`): `ia:usar`, `incidencias:crear` y `evidencias:subir`.
    """
    if not permisos:
        raise ValueError("require_permisos necesita al menos un permiso")

    async def dependencia(
        usuario: Annotated[dict[str, Any], Depends(get_usuario_actual)],
    ) -> dict[str, Any]:
        info = await permisos_del_usuario(usuario)
        faltantes = [permiso for permiso in permisos if permiso not in info["permisos"]]
        if faltantes:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Falta el permiso {faltantes[0]}")
        usuario["_permisos"] = info["permisos"]
        usuario["_alcance"] = info["alcance"]
        return usuario

    return dependencia


def require_permiso(permiso: str):
    return require_permisos(permiso)


def require_algun_permiso(*permisos: str):
    """Exige AL MENOS UNO de los permisos (OR); p. ej. listar roles para asignarlos o para gestionarlos."""
    if not permisos:
        raise ValueError("require_algun_permiso necesita al menos un permiso")

    async def dependencia(
        usuario: Annotated[dict[str, Any], Depends(get_usuario_actual)],
    ) -> dict[str, Any]:
        info = await permisos_del_usuario(usuario)
        if not set(permisos) & set(info["permisos"]):
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Falta el permiso {permisos[0]}")
        usuario["_permisos"] = info["permisos"]
        usuario["_alcance"] = info["alcance"]
        return usuario

    return dependencia


# Roles de sistema administrativos (cuentas privilegiadas). superadmin está por encima de admin.
ROLES_ADMINISTRADORES = ("admin", "superadmin")
# Permiso exclusivo del superadmin: gestionar cuentas privilegiadas, el Centro de control, la auditoría,
# las métricas de IA y los permisos del rol admin.
PERMISO_SUPERADMIN = "sistema:administrar"


def filtro_alcance(usuario: dict[str, Any]) -> dict[str, Any]:
    """Filtro Mongo según el alcance del rol del usuario."""
    alcance = usuario.get("_alcance", "propio")
    if alcance == "global":
        return {}
    if alcance == "area":
        return {"categoria": {"$in": usuario.get("areas", [])}}
    if alcance == "edificio":
        return {"ubicacion.edificio": {"$in": usuario.get("edificios", [])}}
    return {"reportante.usuario_id": usuario["_id"]}


# Jerarquía de alcance: un gestor no puede otorgar más alcance del que tiene.
RANGO_ALCANCE = {"propio": 0, "area": 1, "edificio": 1, "global": 2}


def puede_otorgar(
    actor: dict[str, Any],
    permisos: list[str],
    alcance: str,
    areas: list[str] | None = None,
    edificios: list[str] | None = None,
) -> bool:
    """True si `actor` puede otorgar esos permisos y ese alcance (con sus áreas/edificios) a otro usuario o rol."""
    if not set(permisos) <= set(actor["_permisos"]):
        return False
    propio = actor["_alcance"]
    if propio == "global":
        return True
    if RANGO_ALCANCE.get(alcance, 2) > RANGO_ALCANCE.get(propio, 0):
        return False
    if alcance == "propio":
        return True
    # area/edificio: misma dimensión que el actor y dentro de sus valores
    if alcance != propio:
        return False
    disponibles = set(actor.get("areas" if propio == "area" else "edificios", []))
    pedidos = set((areas if propio == "area" else edificios) or [])
    return pedidos <= disponibles
