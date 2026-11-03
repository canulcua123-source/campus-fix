"""#179: día de los cupos en hora del campus, límite por minuto y verificación de proveedor configurado."""

from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

import app.routers.ia as ia_router
from app.core.limiter import limiter
from app.schemas.incidencia import Ubicacion
from app.services.vision.cupos import clave_cupo_aula, clave_cupo_usuario, dia_campus
from app.services.vision.puerto import ErrorProveedor

# 03:00 UTC del 3 de noviembre = 21:00 del 2 de noviembre en el campus (UTC-6).
NOCHE_UTC = datetime(2026, 11, 3, 3, 0, tzinfo=timezone.utc)


def test_dia_de_cupo_usa_la_zona_del_campus():
    assert dia_campus(NOCHE_UTC) == "2026-11-02"
    assert dia_campus(datetime(2026, 11, 3, 6, 0, tzinfo=timezone.utc)) == "2026-11-03"


def test_claves_de_cupo_diario_cortan_a_medianoche_local():
    usuario, global_ = ia_router._claves_cupo("u1", NOCHE_UTC)
    assert usuario == "ia:uso:u1:2026-11-02"
    assert global_ == "ia:uso:global:2026-11-02"
    assert clave_cupo_usuario("u1", NOCHE_UTC).endswith(":2026-11-02")
    assert clave_cupo_aula(Ubicacion(edificio="A", piso=1, aula="101"), NOCHE_UTC).endswith(":2026-11-02T21")


def test_dia_de_cupo_rechaza_fechas_sin_zona():
    with pytest.raises(ValueError):
        dia_campus(datetime(2026, 11, 3, 3, 0))


def test_analizar_imagen_tiene_limite_por_minuto():
    nombre = f"{ia_router.analizar.__module__}.{ia_router.analizar.__name__}"
    limites = limiter._route_limits.get(nombre) or limiter._dynamic_route_limits.get(nombre)
    assert limites, "POST /ia/analizar-imagen debe llevar @limiter.limit"


def test_proveedor_sin_configurar_responde_503(monkeypatch):
    def sin_llave():
        raise ErrorProveedor("Falta ANTHROPIC_API_KEY", tipo="configuracion")

    monkeypatch.setattr(ia_router, "obtener_proveedor", sin_llave)
    with pytest.raises(HTTPException) as exc:
        ia_router._verificar_proveedor_configurado()
    assert exc.value.status_code == 503
    assert exc.value.detail == "El análisis con IA no está configurado en este servidor"


def test_otros_errores_del_proveedor_no_se_disfrazan(monkeypatch):
    def otro():
        raise ErrorProveedor("x", tipo="http_500")

    monkeypatch.setattr(ia_router, "obtener_proveedor", otro)
    with pytest.raises(ErrorProveedor):
        ia_router._verificar_proveedor_configurado()
