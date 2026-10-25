import asyncio
import base64
import json
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from bson import ObjectId
from httpx import ASGITransport, AsyncClient

from app.core.config import settings
from app.core.security import crear_access_token, crear_refresh_token, decodificar_refresh_token
from app.main import app
from app.routers import auth

from .helpers import PASSWORD, ClienteSeguro

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]


def _cliente(ip: str) -> AsyncClient:
    """Cliente con IP propia para no compartir el contador del rate limit de /auth/login."""
    t = ASGITransport(app=app, raise_app_exceptions=False, client=(ip, 5000))
    return ClienteSeguro(transport=t, base_url="http://test")


async def _login(c: AsyncClient, correo: str = "tecnico_infra@e2e.local"):
    return await c.post("/auth/login", json={"correo": correo, "password": PASSWORD})


def _cookie(respuesta) -> str:
    valor = respuesta.cookies.get(auth.COOKIE_REFRESH)
    assert valor
    return valor


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


async def test_login_emite_cookie_httponly(api):
    async with _cliente("10.0.1.10") as c:
        r = await _login(c)
    assert r.status_code == 200, r.text
    assert "refresh_token" not in r.json()
    cabecera = r.headers["set-cookie"].lower()
    assert "httponly" in cabecera
    assert "path=/auth" in cabecera
    assert "samesite=lax" in cabecera
    assert "secure" not in cabecera  # configuración HTTP explícita del fixture local
    claims = decodificar_refresh_token(_cookie(r))
    assert set(claims) >= {"sub", "jti", "type", "family_id", "iat", "exp", "iss", "aud"}
    assert claims["exp"] - claims["iat"] == settings.jwt_refresh_days * 24 * 3600


async def test_cookie_refresh_es_secure_cuando_corresponde(monkeypatch):
    from starlette.responses import Response

    monkeypatch.setattr(settings, "refresh_cookie_secure", True)
    respuesta = Response()
    auth._establecer_cookie_refresh(
        respuesta,
        "valor-solo-para-probar-atributos",
        int((datetime.now(timezone.utc) + timedelta(days=1)).timestamp()),
    )
    assert "secure" in respuesta.headers["set-cookie"].lower()


async def test_refresh_rota_token(api):
    async with _cliente("10.0.1.11") as c:
        login = await _login(c)
        anterior = _cookie(login)
        r = await c.post("/auth/refresh")
        nuevo = _cookie(r)
        assert r.status_code == 200, r.text
        assert r.json()["token_type"] == "bearer"
        assert r.json()["access_token"]
        assert "refresh_token" not in r.json()
        assert anterior != nuevo
        acceso = await c.get("/categorias", headers={"Authorization": f"Bearer {r.json()['access_token']}"})
        assert acceso.status_code == 200


async def test_refresh_reutilizado_revoca_familia(api):
    async with _cliente("10.0.1.12") as c:
        login = await _login(c)
        refresh_a = _cookie(login)
        primera = await c.post("/auth/refresh")
        assert primera.status_code == 200, primera.text
        refresh_b = _cookie(primera)

    async with _cliente("10.0.1.13") as atacante:
        reuso = await atacante.post("/auth/refresh", headers={"Cookie": f"{auth.COOKIE_REFRESH}={refresh_a}"})
        assert reuso.status_code == 401
        assert reuso.json() == {"error": "no_autenticado", "detalle": "Sesión inválida o expirada"}
    async with _cliente("10.0.1.14") as legitimo:
        familia = await legitimo.post("/auth/refresh", headers={"Cookie": f"{auth.COOKIE_REFRESH}={refresh_b}"})
        assert familia.status_code == 401


async def test_refresh_concurrente_solo_una_rotacion_tiene_exito(api):
    async with _cliente("10.0.1.15") as c:
        refresh_a = _cookie(await _login(c))

    async with _cliente("10.0.1.16") as c1, _cliente("10.0.1.17") as c2:
        cabecera = {"Cookie": f"{auth.COOKIE_REFRESH}={refresh_a}"}
        respuestas = await asyncio.gather(
            c1.post("/auth/refresh", headers=cabecera),
            c2.post("/auth/refresh", headers=cabecera),
        )
    assert sorted(r.status_code for r in respuestas) == [200, 401]
    refresh_emitido = _cookie(next(r for r in respuestas if r.status_code == 200))
    async with _cliente("10.0.1.18") as c:
        r = await c.post("/auth/refresh", headers={"Cookie": f"{auth.COOKIE_REFRESH}={refresh_emitido}"})
    assert r.status_code == 401  # el reuso concurrente revocó toda la familia


async def test_logout_invalida_refresh(api):
    async with _cliente("10.0.1.19") as c:
        refresh = _cookie(await _login(c))
        r = await c.post("/auth/logout")
    assert r.status_code == 204
    assert r.content == b""
    borrado = r.headers["set-cookie"].lower()
    assert "max-age=0" in borrado and "path=/auth" in borrado and "httponly" in borrado
    async with _cliente("10.0.1.20") as c:
        usado = await c.post("/auth/refresh", headers={"Cookie": f"{auth.COOKIE_REFRESH}={refresh}"})
        repetido = await c.post("/auth/logout")
    assert usado.status_code == 401
    assert repetido.status_code == 204 and repetido.content == b""


async def test_refresh_usuario_desactivado_401(api):
    usuario = await api.usuario_temporal()
    async with _cliente("10.0.1.21") as c:
        refresh = _cookie(await _login(c, usuario["correo"]))
    await api.db.usuarios.update_one({"_id": usuario["_id"]}, {"$set": {"activo": False}})
    async with _cliente("10.0.1.22") as c:
        r = await c.post("/auth/refresh", headers={"Cookie": f"{auth.COOKIE_REFRESH}={refresh}"})
    assert r.status_code == 401


async def test_refresh_rechaza_ausente_expirado_alterado_y_access(api):
    sub = str(api.oid("tecnico_infra"))
    expirado, _ = crear_refresh_token(sub, expira_en=datetime.now(timezone.utc) - timedelta(seconds=1))
    async with _cliente("10.0.1.23") as c:
        valido = _cookie(await _login(c))
    partes = valido.split(".")
    partes[2] = ("A" if partes[2][0] != "A" else "B") + partes[2][1:]
    alterado = ".".join(partes)
    casos = [None, expirado, alterado, crear_access_token(sub)]
    for indice, token in enumerate(casos):
        headers = {} if token is None else {"Cookie": f"{auth.COOKIE_REFRESH}={token}"}
        async with _cliente(f"10.0.2.{indice + 1}") as c:
            r = await c.post("/auth/refresh", headers=headers)
        assert r.status_code == 401
        assert set(r.json()) == {"error", "detalle"}


async def test_refresh_no_acepta_token_en_body_ni_authorization(api):
    async with _cliente("10.0.1.28") as c:
        refresh = _cookie(await _login(c))
    async with _cliente("10.0.1.29") as c:
        por_body = await c.post("/auth/refresh", json={"refresh_token": refresh})
        por_bearer = await c.post("/auth/refresh", headers={"Authorization": f"Bearer {refresh}"})
    assert por_body.status_code == 401
    assert por_bearer.status_code == 401


async def test_refresh_no_funciona_como_bearer(api):
    async with _cliente("10.0.1.24") as c:
        refresh = _cookie(await _login(c))
        r = await c.get("/auth/me", headers={"Authorization": f"Bearer {refresh}"})
    assert r.status_code == 401


async def test_refresh_y_logout_validan_origin(api):
    async with _cliente("10.0.1.25") as c:
        await _login(c)
        bloqueado = await c.post("/auth/refresh", headers={"Origin": "https://evil.example"})
        permitido = await c.post("/auth/refresh", headers={"Origin": "http://localhost:5173"})
        logout_bloqueado = await c.post("/auth/logout", headers={"Origin": "null"})
    assert bloqueado.status_code == 403
    assert permitido.status_code == 200
    assert logout_bloqueado.status_code == 403


async def test_refresh_tiene_rate_limit_y_contrato_429(api, monkeypatch):
    monkeypatch.setattr(settings, "limite_refresh", "2/minute")
    async with _cliente("10.0.1.26") as c:
        assert (await _login(c)).status_code == 200
        codigos = [(await c.post("/auth/refresh")).status_code for _ in range(3)]
        ultima = await c.post("/auth/refresh")
    assert codigos == [200, 200, 429]
    assert ultima.status_code == 429
    assert ultima.json()["error"] == "limite"
    assert ultima.headers.get("retry-after", "").isdigit()


async def test_tokens_no_aparecen_en_errores_ni_logs(api, caplog):
    async with _cliente("10.0.1.27") as c:
        token = _cookie(await _login(c))
        r = await c.post("/auth/refresh", headers={"Cookie": f"{auth.COOKIE_REFRESH}={token}x"})
    assert r.status_code == 401
    assert token not in r.text
    assert token not in caplog.text


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


@pytest.mark.parametrize(
    "body",
    [
        {"correo": "usuario@externo.edu.mx", "password": PASSWORD},
        {"correo": "usuario@evile2e.local", "password": PASSWORD},
        {"correo": "tecnico_infra@e2e.local", "password": PASSWORD, "campo_desconocido": True},
    ],
    ids=["dominio_externo", "dominio_parecido", "campo_extra"],
)
async def test_login_contrato_invalido_400(api, body):
    async with _cliente("10.0.1.30") as c:
        r = await c.post("/auth/login", json=body)
    assert r.status_code == 400
    assert r.json()["error"] == "validacion"


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
