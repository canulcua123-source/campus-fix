"""Contrato común de errores HTTP de T-016."""

import time
from datetime import datetime, timezone

import pytest
from bson import ObjectId
from fastapi import Depends, FastAPI, HTTPException, Request
from httpx import ASGITransport, AsyncClient
from limits.errors import StorageError
from pymongo.errors import DuplicateKeyError, WriteError
from redis.exceptions import RedisError
from slowapi import Limiter

from app.core import limiter as limiter_modulo
from app.core.errores import registrar_manejadores_errores
from app.main import _agregar_cabeceras_seguridad, app
from app.routers import auth, incidencias, usuarios

from .helpers import ClienteSeguro

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]

CODIGOS = {
    400: "validacion",
    401: "no_autenticado",
    403: "sin_permiso",
    404: "no_encontrado",
    409: "conflicto",
    411: "longitud_requerida",
    413: "cuerpo_demasiado_grande",
    415: "tipo_no_soportado",
    422: "validacion",
    429: "limite",
    503: "no_disponible",
}

MENSAJES = {
    400: "Datos inválidos",
    401: "No autenticado",
    403: "Acción no autorizada",
    404: "Recurso no encontrado",
    409: "Conflicto de estado",
    411: "Longitud requerida",
    413: "Solicitud demasiado grande",
    415: "Tipo de contenido no soportado",
    422: "Validación inválida",
    429: "Demasiadas solicitudes",
    503: "Servicio no disponible",
}

app_prueba = FastAPI()
registrar_manejadores_errores(app_prueba)


@app_prueba.get("/error/{codigo}")
async def _error_http(codigo: int):
    headers = {"X-Prueba": "conservada"}
    if codigo == 401:
        headers["WWW-Authenticate"] = "Bearer"
    raise HTTPException(codigo, MENSAJES[codigo], headers=headers)


@app_prueba.get("/duplicado")
async def _error_duplicado():
    raise DuplicateKeyError(
        "E11000 duplicate key error collection: utm_desk_test.roles index: clave_1 dup key: { clave: 'privado' }"
    )


@app_prueba.get("/write-error/{codigo}")
async def _error_escritura(codigo: int):
    raise WriteError("detalle interno de MongoDB", code=codigo)


@app_prueba.get("/redis-error")
async def _error_redis():
    raise RedisError("redis://usuario:secreto@infra-privada:6379")


def _assert_contrato(respuesta, status: int, codigo: str) -> dict:
    assert respuesta.status_code == status, respuesta.text
    assert respuesta.headers["content-type"].startswith("application/json")
    cuerpo = respuesta.json()
    assert set(cuerpo) == {"error", "detalle"}
    assert cuerpo["error"] == codigo
    assert isinstance(cuerpo["error"], str)
    assert isinstance(cuerpo["detalle"], (str, list))
    return cuerpo


@pytest.mark.parametrize(
    ("codigo", "status_esperado"),
    [
        (400, 400),
        (401, 401),
        (403, 403),
        (404, 404),
        (409, 409),
        (411, 411),
        (413, 413),
        (415, 415),
        (422, 400),
        (429, 429),
        (503, 503),
    ],
    ids=["400", "401", "403", "404", "409", "411", "413", "415", "422-a-400", "429", "503"],
)
async def test_forma_error(codigo, status_esperado):
    async with AsyncClient(transport=ASGITransport(app=app_prueba), base_url="http://test") as cliente:
        respuesta = await cliente.get(f"/error/{codigo}")
    cuerpo = _assert_contrato(respuesta, status_esperado, CODIGOS[codigo])
    assert cuerpo["detalle"] == MENSAJES[codigo]
    assert respuesta.headers["x-prueba"] == "conservada"
    if codigo == 401:
        assert respuesta.headers["www-authenticate"] == "Bearer"


class _EstrategiaGlobalDoble:
    def __init__(self, reinicio: float, falla_estadisticas: bool = False):
        self.reinicio = reinicio
        self.falla_estadisticas = falla_estadisticas
        self.hits = 0
        self.consultas = 0

    def hit(self, *_):
        self.hits += 1
        return False

    def get_window_stats(self, *_):
        self.consultas += 1
        if self.falla_estadisticas:
            raise StorageError("almacenamiento de prueba no disponible")
        return self.reinicio, 0


def _app_limite_global() -> FastAPI:
    app_global = FastAPI(dependencies=[Depends(limiter_modulo.limite_general)])
    registrar_manejadores_errores(app_global)

    @app_global.get("/recurso")
    async def _recurso():
        return {"ok": True}

    @app_global.get("/health")
    async def _health():
        return {"status": "ok"}

    return app_global


async def test_limite_global_429_retry_after_de_ventana_controlada(monkeypatch):
    estrategia = _EstrategiaGlobalDoble(time.time() + 37)
    monkeypatch.setattr(limiter_modulo.limiter, "_limiter", estrategia)
    async with AsyncClient(transport=ASGITransport(app=_app_limite_global()), base_url="http://test") as cliente:
        respuesta = await cliente.get("/recurso")
        health = await cliente.get("/health")

    cuerpo = _assert_contrato(respuesta, 429, "limite")
    assert cuerpo["detalle"] == "Demasiadas peticiones; espera un momento"
    assert 36 <= int(respuesta.headers["retry-after"]) <= 37
    assert estrategia.hits == estrategia.consultas == 1
    assert health.status_code == 200
    assert health.json() == {"status": "ok"}


async def test_limite_global_con_fallo_de_estadisticas_conserva_429(monkeypatch):
    estrategia = _EstrategiaGlobalDoble(time.time() + 37, falla_estadisticas=True)
    monkeypatch.setattr(limiter_modulo.limiter, "_limiter", estrategia)
    async with AsyncClient(
        transport=ASGITransport(app=_app_limite_global(), raise_app_exceptions=False),
        base_url="http://test",
    ) as cliente:
        respuesta = await cliente.get("/recurso")

    _assert_contrato(respuesta, 429, "limite")
    assert "retry-after" not in respuesta.headers


def _app_slowapi(falla_estadisticas: bool = False) -> FastAPI:
    limitador = Limiter(key_func=lambda request: "cliente-aislado", storage_uri="memory://")
    app_slowapi = FastAPI()
    app_slowapi.state.limiter = limitador
    registrar_manejadores_errores(app_slowapi)

    @app_slowapi.middleware("http")
    async def _seguridad(request: Request, call_next):
        return _agregar_cabeceras_seguridad(request, await call_next(request))

    @app_slowapi.get("/limitado")
    @limitador.limit("1/minute")
    async def _limitado(request: Request):
        return {"ok": True}

    if falla_estadisticas:

        def _fallar_estadisticas(*_):
            raise StorageError("almacenamiento de prueba no disponible")

        limitador.limiter.get_window_stats = _fallar_estadisticas
    return app_slowapi


async def test_slowapi_real_en_memoria_429_con_retry_after_y_seguridad():
    async with AsyncClient(transport=ASGITransport(app=_app_slowapi()), base_url="http://test") as cliente:
        primera = await cliente.get("/limitado")
        respuesta = await cliente.get("/limitado")

    assert primera.status_code == 200
    cuerpo = _assert_contrato(respuesta, 429, "limite")
    assert cuerpo["detalle"] == "Demasiadas solicitudes. Intenta de nuevo más tarde."
    assert 1 <= int(respuesta.headers["retry-after"]) <= 60
    assert respuesta.headers["x-content-type-options"] == "nosniff"
    assert respuesta.headers["cache-control"] == "no-store"


async def test_slowapi_fallo_al_consultar_estadisticas_no_convierte_429_en_500():
    async with AsyncClient(
        transport=ASGITransport(app=_app_slowapi(falla_estadisticas=True), raise_app_exceptions=False),
        base_url="http://test",
    ) as cliente:
        assert (await cliente.get("/limitado")).status_code == 200
        respuesta = await cliente.get("/limitado")

    _assert_contrato(respuesta, 429, "limite")
    assert "retry-after" not in respuesta.headers


class _RedisLoginDoble:
    def __init__(self, correo: str, ip: str, fallos_ip: int, fallos_cuenta: int, ttl_ip: int, ttl_cuenta: int):
        self.clave_ip = f"login:fallos:{correo}:{ip}"
        self.clave_cuenta = f"login:fallos:{correo}"
        self.valores = {self.clave_ip: fallos_ip, self.clave_cuenta: fallos_cuenta}
        self.ttls = {self.clave_ip: ttl_ip, self.clave_cuenta: ttl_cuenta}
        self.consultas_ttl = []

    async def get(self, clave):
        return self.valores[clave]

    async def ttl(self, clave):
        self.consultas_ttl.append(clave)
        return self.ttls[clave]


@pytest.mark.parametrize(
    ("fallos_ip", "fallos_cuenta", "ttl_ip", "ttl_cuenta", "esperado"),
    [
        (auth.MAX_FALLOS_IP, 0, 47, -2, 47),
        (0, auth.MAX_FALLOS_CUENTA, -2, 83, 83),
        (auth.MAX_FALLOS_IP, auth.MAX_FALLOS_CUENTA, 47, 83, 83),
    ],
    ids=["por-ip", "por-cuenta", "ambos-usa-mayor-ttl"],
)
async def test_login_bloqueado_usa_ttl_real_y_no_refleja_credenciales(
    monkeypatch, fallos_ip, fallos_cuenta, ttl_ip, ttl_cuenta, esperado
):
    correo = "persona.secreta@ejemplo.test"
    password = "password-que-no-debe-reflejarse"
    ip = "203.0.113.16"
    redis = _RedisLoginDoble(correo, ip, fallos_ip, fallos_cuenta, ttl_ip, ttl_cuenta)
    monkeypatch.setattr(auth, "get_redis", lambda: redis)
    app_login = FastAPI()
    registrar_manejadores_errores(app_login)

    @app_login.post("/login")
    async def _login(request: Request, datos: auth.LoginIn):
        return await auth.login.__wrapped__(request, datos)

    transporte = ASGITransport(app=app_login, raise_app_exceptions=False, client=(ip, 5000))
    async with AsyncClient(transport=transporte, base_url="http://test") as cliente:
        respuesta = await cliente.post("/login", json={"correo": correo, "password": password})

    _assert_contrato(respuesta, 429, "limite")
    assert int(respuesta.headers["retry-after"]) == esperado
    assert correo not in respuesta.text
    assert password not in respuesta.text


async def test_login_trata_ttl_especial_sin_inventar_tiempo():
    sin_expiracion = _RedisLoginDoble("a@b.test", "127.0.0.1", 0, 0, -1, -2)
    assert await auth._estado_bloqueo(sin_expiracion, [sin_expiracion.clave_ip]) == (True, None)
    assert await auth._estado_bloqueo(sin_expiracion, [sin_expiracion.clave_cuenta]) == (False, None)

    class _RedisConFallo:
        async def ttl(self, _):
            raise RedisError("fallo controlado")

    assert await auth._estado_bloqueo(_RedisConFallo(), ["clave-no-sensible"]) == (True, None)


class _RedisFirmaDoble:
    def __init__(self):
        self.incrementos = []
        self.expiraciones = []

    async def incr(self, clave):
        self.incrementos.append(clave)
        return incidencias.MAX_FIRMAS_DIA + 1

    async def expire(self, clave, segundos):
        self.expiraciones.append((clave, segundos))


@pytest.mark.parametrize(
    ("momento_clave", "momento_calculo", "segundos_esperados"),
    [
        (datetime(2026, 10, 21, 23, 59, 50, tzinfo=timezone.utc),) * 2 + (10,),
        (datetime(2026, 10, 21, 12, 0, tzinfo=timezone.utc),) * 2 + (43_200,),
        (datetime(2026, 1, 31, 23, 30, tzinfo=timezone.utc),) * 2 + (1_800,),
        (datetime(2026, 12, 31, 23, 59, 50, tzinfo=timezone.utc),) * 2 + (10,),
        (datetime(2026, 10, 21, 2, 0, tzinfo=timezone.utc),) * 2 + (79_200,),
        (
            datetime(2026, 10, 21, 23, 59, 59, 900_000, tzinfo=timezone.utc),
            datetime(2026, 10, 22, 0, 0, 0, 100_000, tzinfo=timezone.utc),
            0,
        ),
    ],
    ids=["cerca-medianoche", "mediodia", "cambio-mes", "cambio-anio", "utc-no-hora-local", "carrera-fecha"],
)
async def test_limite_firmas_reinicia_en_medianoche_utc_sin_mutaciones_adicionales(
    monkeypatch, momento_clave, momento_calculo, segundos_esperados
):
    redis = _RedisFirmaDoble()
    monkeypatch.setattr(incidencias, "get_redis", lambda: redis)
    incidencia_privada = "64b000000000000000000016"
    usuario_privado = ObjectId("64b000000000000000000099")

    class _DatetimeControlado:
        instantes = iter((momento_clave, momento_calculo))

        @classmethod
        def now(cls, tz=None):
            instante = next(cls.instantes)
            return instante if tz is None else instante.astimezone(tz)

    monkeypatch.setattr(incidencias, "datetime", _DatetimeControlado)

    async def _incidencia_en_alcance(*_):
        return {"_id": ObjectId(incidencia_privada), "codigo": "RED-PRIVADO", "evidencias_adjuntas": []}

    monkeypatch.setattr(incidencias, "_en_alcance", _incidencia_en_alcance)
    app_firma = FastAPI()
    registrar_manejadores_errores(app_firma)

    @app_firma.post("/firma")
    async def _firma(datos: incidencias.EvidenciaFirmaIn):
        return await incidencias.firmar_evidencia(incidencia_privada, datos, {"_id": usuario_privado})

    async with AsyncClient(transport=ASGITransport(app=app_firma), base_url="http://test") as cliente:
        respuesta = await cliente.post(
            "/firma",
            json={"nombre_archivo": "prueba.pdf", "tipo_mime": "application/pdf", "peso_bytes": 1024},
        )

    cuerpo = _assert_contrato(respuesta, 429, "limite")
    assert cuerpo["detalle"] == f"Límite de {incidencias.MAX_FIRMAS_DIA} archivos por día alcanzado"
    assert respuesta.headers["retry-after"] == str(segundos_esperados)
    assert len(redis.incrementos) == 1
    assert redis.incrementos[0].endswith(f":{momento_clave:%Y-%m-%d}")
    assert redis.expiraciones == []
    assert incidencia_privada not in respuesta.text
    assert str(usuario_privado) not in respuesta.text


async def test_rol_inexistente_no_refleja_valor_del_cliente(monkeypatch):
    class _Roles:
        async def find_one(self, _):
            return None

    class _Db:
        roles = _Roles()

    monkeypatch.setattr(usuarios, "get_db", _Db)
    rol_privado = "rol_ultra_secreto"
    app_rol = FastAPI()
    registrar_manejadores_errores(app_rol)

    @app_rol.get("/rol/{rol}")
    async def _rol(rol: str):
        return await usuarios._validar_asignacion(rol, None, None, {})

    async with AsyncClient(transport=ASGITransport(app=app_rol), base_url="http://test") as cliente:
        respuesta = await cliente.get(f"/rol/{rol_privado}")

    cuerpo = _assert_contrato(respuesta, 400, "validacion")
    assert cuerpo["detalle"] == "El rol indicado no existe"
    assert rol_privado not in respuesta.text


async def test_validacion_422_se_convierte_en_400_y_no_refleja_secretos():
    app_validacion = FastAPI()
    registrar_manejadores_errores(app_validacion)

    @app_validacion.middleware("http")
    async def _seguridad_validacion(request: Request, call_next):
        return _agregar_cabeceras_seguridad(request, await call_next(request))

    @app_validacion.post("/login")
    async def _login_validacion(_: auth.LoginIn):
        return {"ok": True}

    secreto = "token-super-secreto-no-debe-aparecer"
    async with AsyncClient(transport=ASGITransport(app=app_validacion), base_url="http://test") as cliente:
        respuesta = await cliente.post(
            "/login",
            json={"correo": "usuario@ejemplo.com", "password": {"token": secreto}},
        )
    cuerpo = _assert_contrato(respuesta, 400, "validacion")
    assert isinstance(cuerpo["detalle"], list)
    assert cuerpo["detalle"]
    assert all(set(error) == {"type", "loc", "msg"} for error in cuerpo["detalle"])
    assert all(isinstance(error["loc"], list) and isinstance(error["msg"], str) for error in cuerpo["detalle"])
    assert any(error["loc"] == ["body", "password"] for error in cuerpo["detalle"])
    assert secreto not in respuesta.text
    assert all(clave not in respuesta.text for clave in ('"input"', '"ctx"', '"url"'))
    assert respuesta.headers["cache-control"] == "no-store"


async def test_middleware_413_formato_cors_y_cabeceras_seguras():
    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as cliente:
        respuesta = await cliente.post(
            "/auth/login",
            content=b"{}",
            headers={"Content-Length": str(64 * 1024 + 1), "Origin": "http://localhost:5173"},
        )
    cuerpo = _assert_contrato(respuesta, 413, "cuerpo_demasiado_grande")
    assert cuerpo["detalle"] == "El cuerpo de la solicitud es demasiado grande"
    assert respuesta.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert respuesta.headers["x-content-type-options"] == "nosniff"
    assert respuesta.headers["cache-control"] == "no-store"


async def test_middleware_411_conserva_formato():
    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as cliente:
        respuesta = await cliente.post(
            "/auth/login",
            content=b"",
            headers={"Transfer-Encoding": "chunked"},
        )
    cuerpo = _assert_contrato(respuesta, 411, "longitud_requerida")
    assert cuerpo["detalle"] == "Se requiere la cabecera Content-Length"


async def test_duplicate_key_409_formato():
    async with AsyncClient(
        transport=ASGITransport(app=app_prueba, raise_app_exceptions=False),
        base_url="http://test",
    ) as cliente:
        respuesta = await cliente.get("/duplicado")
    cuerpo = _assert_contrato(respuesta, 409, "duplicado")
    assert cuerpo["detalle"] == "Registro duplicado"
    assert "clave_1" not in respuesta.text
    assert "privado" not in respuesta.text


async def test_write_error_no_filtra_detalles_internos():
    async with AsyncClient(
        transport=ASGITransport(app=app_prueba, raise_app_exceptions=False),
        base_url="http://test",
    ) as cliente:
        validacion = await cliente.get("/write-error/121")
        interno = await cliente.get("/write-error/8")

    cuerpo = _assert_contrato(validacion, 400, "validacion")
    assert isinstance(cuerpo["detalle"], list)
    _assert_contrato(interno, 500, "interno")
    assert "detalle interno" not in validacion.text
    assert "detalle interno" not in interno.text


async def test_redis_no_disponible_devuelve_503_sin_datos_internos():
    async with AsyncClient(
        transport=ASGITransport(app=app_prueba, raise_app_exceptions=False),
        base_url="http://test",
    ) as cliente:
        respuesta = await cliente.get("/redis-error")

    cuerpo = _assert_contrato(respuesta, 503, "no_disponible")
    assert cuerpo["detalle"] == "El servicio no está disponible temporalmente"
    assert "secreto" not in respuesta.text
    assert "infra-privada" not in respuesta.text


async def test_rate_limit_429_formato(api):
    transporte = ASGITransport(app=app, raise_app_exceptions=False, client=("10.16.16.16", 4000))
    async with ClienteSeguro(transport=transporte, base_url="http://test") as cliente:
        respuestas = [
            await cliente.post(
                "/auth/login",
                json={"correo": "rate-limit-t016@e2e.local", "password": "incorrecta"},
            )
            for _ in range(11)
        ]
    assert all(respuesta.status_code == 401 for respuesta in respuestas[:10])
    cuerpo = _assert_contrato(respuestas[-1], 429, "limite")
    assert cuerpo["detalle"] == "Demasiadas solicitudes. Intenta de nuevo más tarde."
    assert respuestas[-1].headers["retry-after"].isdigit()
    assert 1 <= int(respuestas[-1].headers["retry-after"]) <= 60
    assert respuestas[-1].headers["cache-control"] == "no-store"


async def test_autenticacion_y_permisos_conservan_semantica(api):
    sin_token = await api.c.get("/incidencias")
    _assert_contrato(sin_token, 401, "no_autenticado")

    sin_permiso = await api.c.get("/analitica/edificios", headers=api.h("reportante_a"))
    _assert_contrato(sin_permiso, 403, "sin_permiso")


async def test_respuesta_exitosa_conserva_estructura():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as cliente:
        respuesta = await cliente.get("/health")
    assert respuesta.status_code == 200
    assert respuesta.json() == {"status": "ok"}
