"""Revisión de claims JWT, autorización vigente y revocación inmediata."""

from datetime import datetime, timedelta, timezone

import jwt
import pytest
from httpx import ASGITransport

from app.core.config import settings
from app.core.limiter import LIMITE_LOGIN
from app.core.security import ALGORITMO, AUDIENCIA, EMISOR, crear_access_token, decodificar_token
from app.main import app

from .helpers import PASSWORD, ClienteSeguro

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]


def _payload(sub: str, **cambios) -> dict:
    ahora = datetime.now(timezone.utc)
    return {
        "sub": sub,
        "iss": EMISOR,
        "aud": AUDIENCIA,
        "iat": ahora,
        "exp": ahora + timedelta(minutes=15),
        **cambios,
    }


def _firmar(payload: dict, algoritmo: str = ALGORITMO) -> str:
    return jwt.encode(payload, settings.jwt_secret, algorithm=algoritmo)


async def _me(api, token: str):
    return await api.c.get("/auth/me", headers={"Authorization": f"Bearer {token}"})


async def test_jwt_emitido_claims_estrictos_y_expira_en_15_minutos(api):
    token = crear_access_token(str(api.oid("reportante_a")))
    payload = decodificar_token(token)
    assert set(payload) >= {"sub", "iss", "aud", "iat", "exp"}
    assert payload["iss"] == EMISOR
    assert payload["aud"] == AUDIENCIA
    assert payload["exp"] - payload["iat"] == 15 * 60
    with pytest.raises(ValueError, match="no se pueden sobrescribir"):
        crear_access_token(str(api.oid("reportante_a")), {"aud": "otra-api"})


@pytest.mark.parametrize("claim", ["sub", "iss", "aud", "iat", "exp"])
async def test_jwt_claims_obligatorios_401(api, claim):
    payload = _payload(str(api.oid("reportante_a")))
    del payload[claim]
    assert (await _me(api, _firmar(payload))).status_code == 401


async def test_jwt_aud_incorrecto_401(api):
    token = _firmar(_payload(str(api.oid("reportante_a")), aud="otra-api"))
    assert (await _me(api, token)).status_code == 401


async def test_jwt_iss_incorrecto_401(api):
    token = _firmar(_payload(str(api.oid("reportante_a")), iss="otro-emisor"))
    assert (await _me(api, token)).status_code == 401


async def test_jwt_expirado_401(api):
    ahora = datetime.now(timezone.utc)
    token = _firmar(
        _payload(
            str(api.oid("reportante_a")),
            iat=ahora - timedelta(minutes=16),
            exp=ahora - timedelta(minutes=1),
        )
    )
    assert (await _me(api, token)).status_code == 401


async def test_jwt_algoritmos_invalidos_401(api):
    payload = _payload(str(api.oid("reportante_a")))
    tokens = [
        jwt.encode(payload, key="", algorithm="none"),
        _firmar(payload, algoritmo="HS512"),
    ]
    for token in tokens:
        assert (await _me(api, token)).status_code == 401


async def test_claims_de_autorizacion_del_token_se_ignoran(api):
    token = crear_access_token(
        str(api.oid("reportante_a")),
        {"rol": "admin", "permisos": ["usuarios:gestionar"], "alcance": "global"},
    )
    r = await api.c.get("/usuarios", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403


async def test_cambio_rol_efecto_inmediato(api):
    usuario = await api.usuario_temporal(rol="reportante")
    headers = {"Authorization": f"Bearer {usuario['token']}"}
    assert (await api.c.get("/analitica/edificios", headers=headers)).status_code == 403

    await api.db.usuarios.update_one({"_id": usuario["_id"]}, {"$set": {"rol": "directivo"}})

    assert (await api.c.get("/analitica/edificios", headers=headers)).status_code == 200


async def test_cambio_rol_a_menos_privilegio_efecto_inmediato(api):
    usuario = await api.usuario_temporal(rol="directivo")
    headers = {"Authorization": f"Bearer {usuario['token']}"}
    assert (await api.c.get("/analitica/edificios", headers=headers)).status_code == 200

    await api.db.usuarios.update_one({"_id": usuario["_id"]}, {"$set": {"rol": "reportante"}})

    assert (await api.c.get("/analitica/edificios", headers=headers)).status_code == 403


async def test_rol_inexistente_queda_sin_permisos(api):
    usuario = await api.usuario_temporal(rol="directivo")
    await api.db.usuarios.update_one({"_id": usuario["_id"]}, {"$set": {"rol": "rol_que_no_existe"}})
    headers = {"Authorization": f"Bearer {usuario['token']}"}
    assert (await api.c.get("/analitica/edificios", headers=headers)).status_code == 403


async def test_jwt_sub_no_objectid_401(api):
    assert (await _me(api, _firmar(_payload("no-es-un-objectid")))).status_code == 401


async def test_usuario_eliminado_access_401(api):
    usuario = await api.usuario_temporal()
    assert (await _me(api, usuario["token"])).status_code == 200
    await api.db.usuarios.delete_one({"_id": usuario["_id"]})
    assert (await _me(api, usuario["token"])).status_code == 401


async def test_login_usuario_desactivado_401(api):
    usuario = await api.usuario_temporal(activo=False)
    transporte = ASGITransport(app=app, raise_app_exceptions=False, client=("10.70.70.71", 4000))
    async with ClienteSeguro(transport=transporte, base_url="http://test") as cliente:
        r = await cliente.post("/auth/login", json={"correo": usuario["correo"], "password": PASSWORD})
    assert r.status_code == 401


async def test_refresh_usuario_desactivado_401(api):
    usuario = await api.usuario_temporal()
    transporte = ASGITransport(app=app, raise_app_exceptions=False, client=("10.70.70.72", 4000))
    async with ClienteSeguro(transport=transporte, base_url="http://test") as cliente:
        login = await cliente.post("/auth/login", json={"correo": usuario["correo"], "password": PASSWORD})
        assert login.status_code == 200, login.text
        await api.db.usuarios.update_one({"_id": usuario["_id"]}, {"$set": {"activo": False}})
        r = await cliente.post("/auth/refresh")
    assert r.status_code == 401


@pytest.mark.parametrize("minutos,valido", [(0, False), (1, True), (15, True), (16, False)])
def test_config_jwt_access_minutes_entre_1_y_15(minutos, valido):
    valores = {**settings.model_dump(), "jwt_access_minutes": minutos}
    if valido:
        assert type(settings)(**valores).jwt_access_minutes == minutos
    else:
        with pytest.raises(ValueError):
            type(settings)(**valores)


async def test_usuario_desactivado_access_401(api):
    usuario = await api.usuario_temporal()
    await api.db.usuarios.update_one({"_id": usuario["_id"]}, {"$set": {"activo": False}})
    assert (await _me(api, usuario["token"])).status_code == 401


async def test_login_rate_limit_valor_doc(api):
    assert LIMITE_LOGIN == "10/minute"

    transporte = ASGITransport(app=app, raise_app_exceptions=False, client=("10.70.70.70", 4000))
    async with ClienteSeguro(transport=transporte, base_url="http://test") as cliente:
        codigos = []
        for intento in range(11):
            password = PASSWORD if intento == 0 else "incorrecta"
            respuesta = await cliente.post(
                "/auth/login",
                json={"correo": "reportante_a@e2e.local", "password": password},
            )
            codigos.append(respuesta.status_code)
    assert codigos == [200, *([401] * 9), 429]
