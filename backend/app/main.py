from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pymongo.errors import DuplicateKeyError, WriteError
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.core import db
from app.core.config import settings
from app.core.limiter import limite_general, limiter
from app.routers import analitica, auth, categorias, ia, incidencias, roles, usuarios


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.abrir()  # los clientes conectan de forma perezosa
    yield
    await db.cerrar()


app = FastAPI(title="UTM Desk API", version="0.1.0", lifespan=lifespan, dependencies=[Depends(limite_general)])
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
# CORS explícito: solo el dominio del frontend, solo los métodos y cabeceras que usa la PWA.
# Sin credenciales: la sesión viaja en el header Authorization, no en cookies.
# (CORS solo protege a los navegadores; curl o un script no lo respetan: la protección real es el JWT + límites.)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_lista,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
    max_age=600,
)

RUTAS_DOCS = ("/docs", "/redoc", "/openapi.json")
CABECERAS_SEGURIDAD = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Resource-Policy": "same-site",
}


@app.middleware("http")
async def _cabeceras_seguridad(request: Request, call_next):
    respuesta = await call_next(request)
    for nombre, valor in CABECERAS_SEGURIDAD.items():
        respuesta.headers.setdefault(nombre, valor)
    if not request.url.path.startswith(RUTAS_DOCS):
        # La API solo devuelve JSON: nada que ejecutar ni incrustar. /docs carga Swagger desde un CDN.
        respuesta.headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        # Respuestas con datos de usuarios: ni el navegador, ni el service worker, ni un proxy deben guardarlas.
        respuesta.headers["Cache-Control"] = "no-store"
    return respuesta


MAX_BODY = {"/ia/analizar-imagen": 6 * 1024 * 1024}
MAX_BODY_DEFECTO = 64 * 1024


@app.middleware("http")
async def _limitar_body(request: Request, call_next):
    # Rechaza cuerpos enormes antes de parsearlos (FastAPI parsea el body antes de autenticar).
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        limite = MAX_BODY.get(request.url.path, MAX_BODY_DEFECTO)
        largo = request.headers.get("content-length")
        if largo is None and request.headers.get("transfer-encoding"):
            return JSONResponse(status_code=411, content={"error": "longitud_requerida"})
        if largo is not None and (not largo.isdigit() or int(largo) > limite):
            return JSONResponse(status_code=413, content={"error": "cuerpo_demasiado_grande"})
    return await call_next(request)


@app.exception_handler(RequestValidationError)
async def _validacion(_: Request, exc: RequestValidationError):
    # Sin "input" ni "ctx": no se reflejan valores enviados (p. ej. contraseñas) en la respuesta.
    errores = [{k: v for k, v in e.items() if k not in ("input", "ctx", "url")} for e in exc.errors()]
    detalle = jsonable_encoder(errores, custom_encoder={Exception: str})
    return JSONResponse(status_code=400, content={"error": "validacion", "detalle": detalle})


@app.exception_handler(WriteError)
async def _write_error(_: Request, exc: WriteError):
    if exc.code == 121:  # falla de $jsonSchema en MongoDB
        return JSONResponse(
            status_code=400,
            content={
                "error": "validacion",
                "detalle": [{"msg": "El documento no cumple el esquema de la base de datos"}],
            },
        )
    return JSONResponse(status_code=500, content={"error": "interno"})


@app.exception_handler(DuplicateKeyError)
async def _duplicado(_: Request, exc: DuplicateKeyError):
    return JSONResponse(status_code=409, content={"error": "duplicado", "detalle": "Registro duplicado"})


@app.get("/health")
async def health():
    return {"status": "ok"}


for r in (auth, incidencias, ia, roles, categorias, analitica, usuarios):
    app.include_router(r.router)
