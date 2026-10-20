from httpx import ASGITransport, AsyncClient

from app.main import app


async def test_health():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


async def test_validacion_devuelve_400():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/auth/login", json={"correo": "no-es-correo"})
    assert r.status_code == 400
    assert r.json()["error"] == "validacion"
