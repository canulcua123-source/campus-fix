"""Capa HTTP: CORS estricto, cabeceras de seguridad, Cache-Control y límites globales de peticiones (#82)."""

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.core.config import Settings, settings
from app.main import app

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]

ORIGEN_OK = "http://localhost:5173"


def _cliente(ip: str) -> AsyncClient:
    return AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False, client=(ip, 5000)), base_url="http://test"
    )


def _h(u: dict) -> dict:
    return {"Authorization": f"Bearer {u['token']}"}


async def test_cabeceras_de_seguridad_y_no_store(api):
    r = await api.c.get("/incidencias", headers=api.h("reportante_a"))
    assert r.status_code == 200
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["referrer-policy"] == "no-referrer"
    assert "max-age" in r.headers["strict-transport-security"]
    assert r.headers["content-security-policy"] == "default-src 'none'; frame-ancestors 'none'"
    assert r.headers["cache-control"] == "no-store"
    # los errores también llevan las cabeceras
    r = await api.c.get("/incidencias")
    assert r.status_code == 401 and r.headers["cache-control"] == "no-store"


async def test_docs_sin_csp_estricta(api):
    r = await api.c.get("/docs")
    assert r.status_code == 200
    assert "content-security-policy" not in r.headers  # Swagger carga scripts de un CDN
    assert r.headers["x-content-type-options"] == "nosniff"


async def test_cors_solo_origen_permitido_y_sin_credenciales():
    async with _cliente("10.95.0.1") as c:
        ok = await c.options(
            "/incidencias",
            headers={
                "Origin": ORIGEN_OK,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
        assert ok.headers.get("access-control-allow-origin") == ORIGEN_OK
        assert "access-control-allow-credentials" not in ok.headers
        assert "PUT" not in ok.headers.get("access-control-allow-methods", "")
        malo = await c.options(
            "/incidencias", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"}
        )
        assert "access-control-allow-origin" not in malo.headers
        # una cabecera que la PWA no usa no se autoriza
        raro = await c.options(
            "/incidencias",
            headers={
                "Origin": ORIGEN_OK,
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "x-admin-override",
            },
        )
        assert raro.status_code == 400


def test_cors_rechaza_comodin():
    with pytest.raises(ValidationError):
        Settings(cors_origins="*", jwt_secret="x" * 40)
    with pytest.raises(ValidationError):
        Settings(cors_origins="http://localhost:5173,*", jwt_secret="x" * 40)


async def test_limite_general_por_usuario(api, monkeypatch):
    monkeypatch.setattr(settings, "limite_general", "3/minute")
    a, b = await api.usuario_temporal(), await api.usuario_temporal()
    async with _cliente("10.95.1.1") as c:
        codigos = [(await c.get("/categorias", headers=_h(a))).status_code for _ in range(4)]
        assert codigos == [200, 200, 200, 429]
        # otro usuario detrás de la misma IP no se ve afectado
        assert (await c.get("/categorias", headers=_h(b))).status_code == 200


async def test_sin_token_cuenta_por_ip(monkeypatch):
    monkeypatch.setattr(settings, "limite_general", "2/minute")
    async with _cliente("10.95.2.1") as c:
        codigos = [(await c.get("/categorias")).status_code for _ in range(3)]
    assert codigos == [401, 401, 429]


async def test_health_no_tiene_limite(monkeypatch):
    monkeypatch.setattr(settings, "limite_general", "1/minute")
    async with _cliente("10.95.3.1") as c:
        codigos = [(await c.get("/health")).status_code for _ in range(5)]
    assert codigos == [200] * 5


async def test_consultas_pesadas_tienen_limite_propio(api, monkeypatch):
    monkeypatch.setattr(settings, "limite_consulta_pesada", "2/minute")
    u = await api.usuario_temporal(rol="directivo")
    async with _cliente("10.95.4.1") as c:
        busqueda = [
            (await c.get("/incidencias/buscar", params={"q": "switch"}, headers=_h(u))).status_code for _ in range(3)
        ]
        assert busqueda == [200, 200, 429]
        analitica = [(await c.get("/analitica/tags", headers=_h(u))).status_code for _ in range(3)]
        assert analitica == [200, 200, 429]
