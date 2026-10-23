from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import Response

from app.core import db
from app.core.config import settings
from app.core.errores import registrar_manejadores_errores, respuesta_error
from app.core.limiter import limite_general, limiter
from app.routers import analitica, auth, categorias, ia, incidencias, roles, usuarios


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.abrir()  # los clientes conectan de forma perezosa
    yield
    await db.cerrar()


app = FastAPI(title="UTM Desk API", version="0.1.0", lifespan=lifespan, dependencies=[Depends(limite_general)])
app.state.limiter = limiter
registrar_manejadores_errores(app)
RUTAS_DOCS = ("/docs", "/redoc", "/openapi.json")
CABECERAS_SEGURIDAD = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Resource-Policy": "same-site",
}


def _agregar_cabeceras_seguridad(request: Request, respuesta: Response) -> Response:
    for nombre, valor in CABECERAS_SEGURIDAD.items():
        respuesta.headers.setdefault(nombre, valor)
    if not request.url.path.startswith(RUTAS_DOCS):
        respuesta.headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        respuesta.headers["Cache-Control"] = "no-store"
    return respuesta


@app.middleware("http")
async def _cabeceras_seguridad(request: Request, call_next):
    return _agregar_cabeceras_seguridad(request, await call_next(request))


MAX_BODY = {"/ia/analizar-imagen": 6 * 1024 * 1024}
MAX_BODY_DEFECTO = 64 * 1024


@app.middleware("http")
async def _limitar_body(request: Request, call_next):
    # Rechaza cuerpos enormes antes de parsearlos (FastAPI parsea el body antes de autenticar).
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        limite = MAX_BODY.get(request.url.path, MAX_BODY_DEFECTO)
        largo = request.headers.get("content-length")
        if largo is None and request.headers.get("transfer-encoding"):
            respuesta = respuesta_error(411, "longitud_requerida", "Se requiere la cabecera Content-Length")
            return _agregar_cabeceras_seguridad(request, respuesta)
        if largo is not None and (not largo.isdigit() or int(largo) > limite):
            respuesta = respuesta_error(413, "cuerpo_demasiado_grande", "El cuerpo de la solicitud es demasiado grande")
            return _agregar_cabeceras_seguridad(request, respuesta)
    return await call_next(request)


# CORS explícito queda por fuera de los middlewares HTTP para cubrir también los rechazos 411/413.
# Credenciales habilitadas solo para orígenes exactos: permiten la cookie HttpOnly de refresh.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_lista,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
    max_age=600,
)


@app.get("/health")
async def health():
    return {"status": "ok"}


for r in (auth, incidencias, ia, roles, categorias, analitica, usuarios):
    app.include_router(r.router)
