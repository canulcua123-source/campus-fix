from datetime import datetime, timezone

import pytest

from app.dominio.folio import fecha_local_campus, formatear_folio, prefijo_folio


def test_folio_usa_dia_de_america_mexico_city():
    instante = datetime(2026, 10, 24, 2, 30, tzinfo=timezone.utc)
    assert fecha_local_campus(instante).day == 23
    assert prefijo_folio("computo_redes", instante) == "INC-2026-1023-RED-"
    assert formatear_folio("computo_redes", 7, instante) == "INC-2026-1023-RED-0007"


@pytest.mark.parametrize(
    ("categoria", "esperado"),
    [("computo_redes", "RED"), ("infraestructura", "INF"), ("academico", "ACA")],
)
def test_prefijos_de_categoria(categoria, esperado):
    instante = datetime(2026, 1, 2, 12, tzinfo=timezone.utc)
    assert f"-{esperado}-" in formatear_folio(categoria, 1, instante)


def test_folio_categoria_personalizada_usa_prefijo_validado():
    instante = datetime(2026, 1, 2, 12, tzinfo=timezone.utc)
    assert formatear_folio("servicios_medicos", 12, instante, "MED") == "INC-2026-0102-MED-0012"
    with pytest.raises(ValueError):
        formatear_folio("servicios_medicos", 12, instante, "M3D")


def test_folio_rechaza_datos_invalidos():
    consciente = datetime(2026, 1, 2, tzinfo=timezone.utc)
    with pytest.raises(ValueError):
        formatear_folio("desconocida", 1, consciente)
    with pytest.raises(ValueError):
        formatear_folio("academico", 0, consciente)
    with pytest.raises(ValueError):
        formatear_folio("academico", 1, datetime(2026, 1, 2))
