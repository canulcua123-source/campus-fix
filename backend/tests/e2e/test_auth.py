import base64
import json
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from bson import ObjectId
from httpx import ASGITransport, AsyncClient

from app.core.config import settings
from app.core.security import crear_access_token
from app.main import app

from .helpers import PASSWORD, ClienteSeguro

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]


def _cliente(ip: str) -> AsyncClient:
    """Cliente con IP propia para no compartir el contador del rate limit de /auth/login."""
    t = ASGITransport(app=app, raise_app_exceptions=False, client=(ip, 5000))
    return ClienteSeguro(transport=t, base_url="http://test")


async def test_login_ok(api):
    async with _cliente("10.0.1.1") as c:
        r = await c.post("/auth/login", json={"correo": "tecnico_infra@e2e.local", "password": PASSWORD})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["token_type"] == "bearer" and body["access_token"]
    assert set(body["usuario"]) >= {"nombre", "rol", "permisos", "alcance"}
    assert body["usuario"]["rol"] == "tecnico" and body["usuario"]["alcance"] == "area"
    assert "seguimiento:registrar" in body["usuario"]["permisos"]
    # El token emitido sirve
    r2 = await api.c.get("/categorias", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert r2.status_code == 200


@pytest.mark.parametrize(
    "correo,pwd",
    [
        ("tecnico_infra@e2e.local", "incorrecta-123"),
        ("noexiste@e2e.local", PASSWORD),
        ("inactivo@e2e.local", PASSWORD),
    ],
    ids=["password_incorrecto", "desconocido", "inactivo"],
)
async def test_login_rechazado(api, correo, pwd):
    async with _cliente("10.0.1.2") as c:
        r = await c.post("/auth/login", json={"correo": correo, "password": pwd})
    assert r.status_code == 401, r.text


async def test_login_inyeccion_nosql(api):
    async with _cliente("10.0.1.3") as c:
        r = await c.post("/auth/login", json={"correo": {"$ne": ""}, "password": {"$ne": ""}})
    assert r.status_code == 400


async def test_me(api):
    r = await api.c.get("/auth/me", headers=api.h("coordinador_infra"))
    assert r.status_code == 200, r.text
    b = r.json()
    assert set(b) >= {"_id", "nombre", "correo", "rol", "permisos", "alcance"}
    assert b["_id"] == str(api.oid("coordinador_infra"))
    assert b["correo"] == "coordinador_infra@e2e.local"
    assert b["rol"] == "coordinador" and b["alcance"] == "area"
    assert "incidencias:asignar" in b["permisos"]
    assert "password_hash" not in b


def _token_none(sub: str) -> str:
    enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()  # noqa: E731
    exp = int((datetime.now(timezone.utc) + timedelta(minutes=5)).timestamp())
    return f"{enc({'alg': 'none', 'typ': 'JWT'})}.{enc({'sub': sub, 'exp': exp})}."


async def test_ataques_token(api):
    sub = str(api.oid("admin"))
    ahora = datetime.now(timezone.utc)
    borrado = await api.usuario_temporal()
    await api.db.usuarios.delete_one({"_id": borrado["_id"]})
    tokens = {
        "basura": "esto.no.es.un.jwt",
        "firma_incorrecta": jwt.encode(
            {"sub": sub, "exp": ahora + timedelta(minutes=5)}, "otro-secreto-" * 4, algorithm="HS256"
        ),
        "expirado": jwt.encode(
            {"sub": sub, "iat": ahora - timedelta(hours=1), "exp": ahora - timedelta(minutes=1)},
            settings.jwt_secret,
            algorithm="HS256",
        ),
        "alg_none": _token_none(sub),
        "sub_no_oid": jwt.encode(
            {"sub": "admin", "exp": ahora + timedelta(minutes=5)}, settings.jwt_secret, algorithm="HS256"
        ),
        "usuario_borrado": borrado["token"],
        "usuario_inactivo": api.u["inactivo"]["token"],
        "usuario_inexistente": crear_access_token(str(ObjectId())),
    }
    for nombre, tok in tokens.items():
        r = await api.c.get("/auth/me", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 401, f"{nombre}: {r.status_code}"
        r = await api.c.get("/incidencias", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 401, f"{nombre} /incidencias: {r.status_code}"
    r = await api.c.get("/incidencias")
    assert r.status_code == 401
    r = await api.c.get("/incidencias", headers={"Authorization": "Basic abc"})
    assert r.status_code == 401
