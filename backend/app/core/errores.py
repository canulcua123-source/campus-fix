"""Manejadores comunes para respuestas de error de la API."""

import logging
import math
import time
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from limits.errors import StorageError
from pymongo.errors import DuplicateKeyError, WriteError
from redis.exceptions import RedisError
from slowapi.errors import RateLimitExceeded
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

CODIGOS_HTTP = {
    400: "validacion",
    401: "no_autenticado",
    403: "sin_permiso",
    404: "no_encontrado",
    405: "metodo_no_permitido",
    409: "conflicto",
    411: "longitud_requerida",
    413: "cuerpo_demasiado_grande",
    415: "tipo_no_soportado",
    422: "validacion",
    429: "limite",
    500: "interno",
    502: "no_disponible",
    503: "no_disponible",
    504: "no_disponible",
}

MENSAJES_HTTP = {
    400: "La solicitud contiene datos inválidos",
    401: "No autenticado",
    403: "No tienes permiso para realizar esta acción",
    404: "Recurso no encontrado",
    405: "Método HTTP no permitido",
    409: "La solicitud entra en conflicto con el estado actual",
    411: "Se requiere la cabecera Content-Length",
    413: "El cuerpo de la solicitud es demasiado grande",
    415: "Tipo de contenido no soportado",
    422: "La solicitud contiene datos inválidos",
    429: "Demasiadas solicitudes. Intenta de nuevo más tarde.",
    500: "Ocurrió un error interno. Intenta de nuevo más tarde.",
    502: "El servicio no está disponible temporalmente",
    503: "El servicio no está disponible temporalmente",
    504: "El servicio no está disponible temporalmente",
}

MENSAJES_VALIDACION = {
    "missing": "Campo obligatorio",
    "string_too_short": "Texto demasiado corto",
    "string_too_long": "Texto demasiado largo",
    "string_pattern_mismatch": "Formato inválido",
    "string_type": "Debe ser texto",
    "too_short": "Faltan elementos",
    "too_long": "Demasiados elementos",
    "greater_than_equal": "El valor es menor al mínimo",
    "less_than_equal": "El valor excede el máximo",
    "greater_than": "El valor es demasiado pequeño",
    "less_than": "El valor es demasiado grande",
    "int_parsing": "Debe ser un número entero",
    "int_type": "Debe ser un número entero",
    "int_from_float": "Debe ser un número entero",
    "float_parsing": "Debe ser un número",
    "float_type": "Debe ser un número",
    "bool_parsing": "Debe ser sí o no",
    "bool_type": "Debe ser sí o no",
    "literal_error": "Opción no válida",
    "enum": "Opción no válida",
    "union_tag_invalid": "Categoría no válida",
    "union_tag_not_found": "Falta la categoría",
    "ip_any_address": "IP inválida",
    "uuid_parsing": "Identificador inválido",
    "uuid_version": "Identificador inválido",
    "extra_forbidden": "Campo no permitido",
    "value_error": "Valor inválido",
    "list_type": "Debe ser una lista",
    "json_invalid": "JSON inválido",
}

_DETALLES_PREDETERMINADOS = {
    "Bad Request",
    "Unauthorized",
    "Forbidden",
    "Not Found",
    "Method Not Allowed",
    "Request Entity Too Large",
    "Unsupported Media Type",
    "Unprocessable Entity",
    "Too Many Requests",
    "Internal Server Error",
    "Bad Gateway",
    "Service Unavailable",
    "Gateway Timeout",
}


def respuesta_error(
    status_code: int,
    error: str,
    detalle: str | list[dict[str, Any]],
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    """Construye el contrato único sin agregar campos implícitos."""
    return JSONResponse(
        status_code=status_code,
        content={"error": error, "detalle": detalle},
        headers=headers,
    )


def cabeceras_retry_after(segundos: int | None) -> dict[str, str] | None:
    """Crea Retry-After solo cuando el origen proporcionó una duración fiable."""
    if segundos is None:
        return None
    if segundos < 0:
        raise ValueError("Retry-After no puede ser negativo")
    return {"Retry-After": str(segundos)}


def segundos_hasta_reinicio(reinicio: float) -> int:
    """Convierte la marca temporal absoluta de limits en segundos restantes."""
    return max(1, math.ceil(reinicio - time.time()))


def _detalle_http(status_code: int, detalle: Any) -> str:
    if isinstance(detalle, str) and detalle.strip() and detalle not in _DETALLES_PREDETERMINADOS:
        return detalle
    return MENSAJES_HTTP.get(status_code, "La solicitud no pudo completarse")


async def manejar_http_exception(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    # FastAPI reserva 422 para validación; el contrato del proyecto la expone como 400.
    status_code = 400 if exc.status_code == 422 else exc.status_code
    return respuesta_error(
        status_code,
        CODIGOS_HTTP.get(status_code, "error_http"),
        _detalle_http(exc.status_code, exc.detail),
        dict(exc.headers) if exc.headers else None,
    )


def _errores_validacion(exc: RequestValidationError) -> list[dict[str, Any]]:
    errores = []
    for error in exc.errors():
        tipo = str(error.get("type", "value_error"))
        errores.append(
            {
                "type": tipo,
                "loc": list(error.get("loc", ())),
                "msg": MENSAJES_VALIDACION.get(tipo, "Valor inválido"),
            }
        )
    return errores


async def manejar_validacion(_: Request, exc: RequestValidationError) -> JSONResponse:
    # Solo se conservan type, loc y msg: nunca input, ctx, url ni valores de la solicitud.
    return respuesta_error(400, "validacion", _errores_validacion(exc))


async def manejar_write_error(_: Request, exc: WriteError) -> JSONResponse:
    if exc.code == 121:
        return respuesta_error(
            400,
            "validacion",
            [{"type": "value_error", "loc": ["body"], "msg": "El documento no cumple el esquema de la base de datos"}],
        )
    return respuesta_error(500, "interno", MENSAJES_HTTP[500])


async def manejar_duplicado(_: Request, __: DuplicateKeyError) -> JSONResponse:
    return respuesta_error(409, "duplicado", "Registro duplicado")


async def manejar_dependencia_limites(_: Request, exc: RedisError | StorageError) -> JSONResponse:
    logger.exception("No está disponible el almacenamiento de los límites", exc_info=exc)
    return respuesta_error(503, "no_disponible", MENSAJES_HTTP[503])


def _segundos_reintento(request: Request, _: RateLimitExceeded) -> int | None:
    limite_actual = getattr(request.state, "view_rate_limit", None)
    if limite_actual is None:
        logger.error("SlowAPI generó 429 sin información de la ventana excedida")
        return None
    limite, argumentos = limite_actual
    try:
        reinicio, _ = request.app.state.limiter.limiter.get_window_stats(limite, *argumentos)
    except (RedisError, StorageError):
        logger.exception("No fue posible consultar la ventana excedida de SlowAPI")
        return None
    return segundos_hasta_reinicio(reinicio)


async def manejar_rate_limit(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    return respuesta_error(
        429,
        "limite",
        MENSAJES_HTTP[429],
        cabeceras_retry_after(_segundos_reintento(request, exc)),
    )


def registrar_manejadores_errores(app: FastAPI) -> None:
    app.add_exception_handler(StarletteHTTPException, manejar_http_exception)
    app.add_exception_handler(RequestValidationError, manejar_validacion)
    app.add_exception_handler(WriteError, manejar_write_error)
    app.add_exception_handler(DuplicateKeyError, manejar_duplicado)
    app.add_exception_handler(RedisError, manejar_dependencia_limites)
    app.add_exception_handler(StorageError, manejar_dependencia_limites)
    app.add_exception_handler(RateLimitExceeded, manejar_rate_limit)
