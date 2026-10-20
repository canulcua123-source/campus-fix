"""CORS y rate limit del login. El archivo se llama zz_ para correr al final."""
import pytest
from httpx import ASGITransport

from app.main import app

from .helpers import PASSWORD, ClienteSeguro

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]

PREFLIGHT = {"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type"}


async def test_cors_origen_permitido(api):
    r = await api.c.options("/incidencias", headers={"Origin": "http://localhost:5173", **PREFLIGHT})
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"
    r = await api.c.get("/health", headers={"Origin": "http://localhost:5173"})
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"


async def test_cors_origen_ajeno(api):
    r = await api.c.options("/incidencias", headers={"Origin": "http://evil.example", **PREFLIGHT})
    assert "access-control-allow-origin" not in r.headers
    r = await api.c.get("/health", headers={"Origin": "http://evil.example"})
    assert "access-control-allow-origin" not in r.headers


async def test_login_rate_limit_429(api):
    t = ASGITransport(app=app, raise_app_exceptions=False, client=("10.66.66.66", 4000))
    async with ClienteSeguro(transport=t, base_url="http://test") as c:
        codigos = []
        for i in range(11):
            pwd = PASSWORD if i == 0 else "incorrecta"
            r = await c.post("/auth/login", json={"correo": "reportante_a@e2e.local", "password": pwd})
            codigos.append(r.status_code)
        assert codigos[0] == 200
        assert all(x == 401 for x in codigos[1:10]), codigos
        assert codigos[10] == 429, codigos
        # Incluso con credenciales correctas sigue bloqueado
        r = await c.post("/auth/login", json={"correo": "reportante_a@e2e.local", "password": PASSWORD})
        assert r.status_code == 429
    # Otro cliente no se ve afectado
    t2 = ASGITransport(app=app, raise_app_exceptions=False, client=("10.66.66.67", 4000))
    async with ClienteSeguro(transport=t2, base_url="http://test") as c2:
        r = await c2.post("/auth/login", json={"correo": "Reportante_A@e2e.local ", "password": PASSWORD})
        assert r.status_code == 200, r.text
