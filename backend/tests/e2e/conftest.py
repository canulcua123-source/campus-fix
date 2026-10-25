"""Infraestructura e2e: Mongo/Redis locales (docker compose), app en proceso vía ASGITransport.

Las variables de entorno se fijan ANTES de importar `app` (las env vars ganan sobre backend/.env).
"""

import os
import sys

_ENV = {
    "MONGODB_URI": "mongodb://localhost:27017",
    "MONGODB_ADMIN_URI": "",
    "MONGODB_DB": "utm_desk_test",
    "REDIS_URL": "redis://localhost:6379/15",
    "JWT_SECRET": "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0",
    "R2_ACCOUNT_ID": "test",
    "R2_ACCESS_KEY_ID": "test",
    "R2_SECRET_ACCESS_KEY": "test",
    "R2_BUCKET": "test-bucket",
    "R2_VERIFICAR_SUBIDA": "false",
    "LIMITE_ESCRITURA": "100000/minute",
    "LIMITE_GENERAL": "100000/minute",
    "LIMITE_CONSULTA_PESADA": "100000/minute",  # la suite hace cientos de peticiones; los límites reales se prueban aparte
    "IA_HABILITADA": "true",
    "CORS_ORIGINS": "http://localhost:5173",
    "ANTHROPIC_API_KEY": "",
    "SEED_ADMIN_PASSWORD": "AdminE2E-Password1",
}
os.environ.update(_ENV)

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402

if "app.core.config" in sys.modules:
    # La configuración ya se instanció (p.ej. por otro test) con otro entorno: no arriesgar.
    from app.core.config import settings as _s

    if _s.mongodb_uri != _ENV["MONGODB_URI"] or _s.mongodb_db != _ENV["MONGODB_DB"]:
        pytest.exit("e2e: settings ya cargados con una BD no local; ejecuta `pytest tests/e2e` aparte", returncode=3)

from app.core.config import settings  # noqa: E402

if not (
    settings.mongodb_uri.startswith("mongodb://localhost")
    and settings.mongodb_admin_uri == ""
    and settings.mongodb_db == "utm_desk_test"
    and settings.redis_url.endswith("/15")
):
    pytest.exit(f"e2e: guard falló, mongodb_uri={settings.mongodb_uri!r} db={settings.mongodb_db!r}", returncode=3)

from .helpers import Api, ClienteSeguro, PASSWORD, sembrar_usuarios  # noqa: E402


def pytest_configure(config):
    config.addinivalue_line("markers", "e2e: pruebas end-to-end contra Mongo/Redis locales")


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def entorno():
    from httpx import ASGITransport
    from pymongo import AsyncMongoClient
    from redis.asyncio import Redis

    from app.core import db as core_db
    from app.main import app
    from scripts.init_db import (
        asegurar_coleccion,
        crear_indices,
        esquema_configuracion_ia,
        esquema_incidencias,
        sembrar_base,
    )

    cliente = AsyncMongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=3000)
    await cliente.drop_database(settings.mongodb_db)
    tdb = cliente[settings.mongodb_db]
    await asegurar_coleccion(tdb, "incidencias_campus", esquema_incidencias())
    await asegurar_coleccion(tdb, "configuracion_ia", esquema_configuracion_ia())
    for nombre in ("usuarios", "roles", "categorias"):
        await asegurar_coleccion(tdb, nombre)
    await crear_indices(tdb)
    admin = await sembrar_base(tdb)
    usuarios = await sembrar_usuarios(tdb, admin)
    await cliente.close()

    r = Redis.from_url(settings.redis_url)
    await r.flushdb()
    await r.aclose()

    core_db.abrir()
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with ClienteSeguro(transport=transport, base_url="http://test") as client:
        yield Api(client, usuarios, core_db.get_db())
    await core_db.cerrar()


@pytest.fixture
def api(entorno):
    return entorno


@pytest.fixture
def password():
    return PASSWORD
