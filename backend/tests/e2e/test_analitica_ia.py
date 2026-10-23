from io import BytesIO

import pytest
from PIL import Image

import app.routers.ia as ia_router
from app.core.config import settings
from app.schemas.ia import AnalisisImagen

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]

FILTRO_RESUELTAS = {"estado": {"$in": ["resuelta", "cerrada"]}, "fecha_resolucion": {"$type": "date"}}


async def _preparar(api):
    # Garantiza datos resueltos en ambas categorías y edificios distintos
    await api.crear_en(
        "resuelta", "reportante_a", "infraestructura", edificio="Edificio A", tags=["analitica_tag", "luz"]
    )
    await api.crear_en("cerrada", "reportante_a", "infraestructura", edificio="Edificio B", tags=["analitica_tag"])
    await api.crear_en(
        "resuelta", "reportante_a", "computo_redes", edificio="Edificio C", tags=["analitica_tag", "red"]
    )


async def test_analitica_edificios(api):
    await _preparar(api)
    r = await api.c.get("/analitica/edificios", headers=api.h("directivo"))
    assert r.status_code == 200, r.text
    filas = r.json()
    assert len(filas) <= 10
    for f in filas:
        assert set(f) == {"edificio", "total", "horas_invertidas", "horas_resolucion_prom"}
        if f["horas_resolucion_prom"] is not None:
            assert round(f["horas_resolucion_prom"], 1) == f["horas_resolucion_prom"]
    proms = [f["horas_resolucion_prom"] or 0 for f in filas]
    assert proms == sorted(proms, reverse=True)
    total_bd = await api.db.incidencias_campus.count_documents(FILTRO_RESUELTAS)
    assert sum(f["total"] for f in filas) == total_bd

    r = await api.c.get("/analitica/edificios", headers=api.h("coordinador_infra"))
    assert r.status_code == 200
    filas_c = r.json()
    total_infra = await api.db.incidencias_campus.count_documents({**FILTRO_RESUELTAS, "categoria": "infraestructura"})
    assert sum(f["total"] for f in filas_c) == total_infra < total_bd
    assert "Edificio C" not in {f["edificio"] for f in filas_c}  # sólo hay redes resueltas en C


async def test_analitica_tags(api):
    await _preparar(api)
    r = await api.c.get("/analitica/tags", headers=api.h("admin"))
    assert r.status_code == 200, r.text
    filas = r.json()
    assert 0 < len(filas) <= 10
    assert all(set(f) == {"tag", "total"} for f in filas)
    totales = [f["total"] for f in filas]
    assert totales == sorted(totales, reverse=True)

    r = await api.c.get("/analitica/tags", headers=api.h("coordinador_infra"))
    tags_c = {f["tag"]: f["total"] for f in r.json()}
    assert "red" not in tags_c
    n = await api.db.incidencias_campus.count_documents({"categoria": "infraestructura", "tags": "analitica_tag"})
    if "analitica_tag" in tags_c:
        assert tags_c["analitica_tag"] == n


@pytest.mark.parametrize(
    "quien,esperado",
    [
        ("reportante_a", 403),
        ("tecnico_infra", 403),
        ("jefe_a", 403),
        ("coordinador_infra", 200),
        ("directivo", 200),
        ("admin", 200),
    ],
)
async def test_analitica_permisos(api, quien, esperado):
    for ruta in ("/analitica/edificios", "/analitica/tags"):
        assert (await api.c.get(ruta, headers=api.h(quien))).status_code == esperado, ruta
    assert (await api.c.get("/analitica/tags")).status_code == 401


# ---------- IA ----------

ANALISIS = AnalisisImagen(
    es_incidencia_valida=True,
    categoria="infraestructura",
    titulo="Luminaria fundida",
    descripcion="Se observa una luminaria apagada",
    prioridad_sugerida="baja",
    tags=["luminaria"],
    campos_detectados=[{"nombre": "tipo", "valor": "luminaria"}],
    confianza=0.9,
    advertencias=[],
)


def _imagen_png(ancho=200, alto=200):
    salida = BytesIO()
    Image.new("RGB", (ancho, alto), "white").save(salida, format="PNG")
    return salida.getvalue()


PNG = _imagen_png()


@pytest.fixture
def ia_falsa(monkeypatch):
    llamadas = []

    async def fake(datos, media_type, contexto=None):
        llamadas.append((len(datos), media_type, contexto))
        return ANALISIS

    monkeypatch.setattr(ia_router, "analizar_imagen", fake)
    return llamadas


async def _post(api, quien="reportante_a", nombre="foto.png", datos=PNG, mime="image/png", contexto=None):
    data = {"contexto": contexto} if contexto else None
    return await api.c.post(
        "/ia/analizar-imagen", files={"imagen": (nombre, datos, mime)}, data=data, headers=api.h(quien)
    )


async def test_ia_ok(api, ia_falsa):
    r = await _post(api, contexto="pasillo del edificio A")
    assert r.status_code == 200, r.text
    assert r.json()["categoria"] == "infraestructura"
    AnalisisImagen.model_validate(r.json())
    assert ia_falsa == [(len(PNG), "image/png", "pasillo del edificio A")]


async def test_ia_rechaza_falso_jpeg_415(api, ia_falsa):
    r = await _post(api, nombre="programa.jpg", datos=b"MZ" + b"\0" * 100, mime="image/jpeg")
    assert r.status_code == 415, r.text
    assert "JPEG, PNG o WebP" in r.json()["detail"]
    assert ia_falsa == []


async def test_ia_png_renombrado_ok(api, ia_falsa):
    r = await _post(api, nombre="foto.jpg", datos=PNG, mime="image/jpeg")
    assert r.status_code == 200, r.text
    assert ia_falsa == [(len(PNG), "image/png", None)]


async def test_ia_imagen_pequena_422(api, ia_falsa):
    r = await _post(api, datos=_imagen_png(100, 100))
    assert r.status_code == 422, r.text
    assert "200–2600 px" in r.json()["detail"]
    assert ia_falsa == []


async def test_ia_imagen_grande_413(api, ia_falsa):
    r = await _post(api, datos=b"\x89PNG\r\n\x1a\n" + b"0" * (5 * 1024 * 1024))
    assert r.status_code == 413, r.text
    assert "5 MB" in r.json()["detail"]
    assert ia_falsa == []


@pytest.mark.parametrize("quien,esperado", [("directivo", 403), ("jefe_a", 403), ("tecnico_infra", 200)])
async def test_ia_permisos(api, ia_falsa, quien, esperado):
    assert (await _post(api, quien=quien)).status_code == esperado


@pytest.mark.parametrize(
    "nombre,mime,datos",
    [
        ("a.txt", "text/plain", b"hola"),
        ("a.gif", "image/gif", b"GIF89a"),
    ],
    ids=["texto", "gif"],
)
async def test_ia_formato_no_permitido(api, ia_falsa, nombre, mime, datos):
    r = await _post(api, nombre=nombre, datos=datos, mime=mime)
    assert r.status_code == 415, r.text
    assert ia_falsa == []


async def test_ia_sin_imagen(api, ia_falsa):
    r = await api.c.post("/ia/analizar-imagen", headers=api.h("reportante_a"))
    assert r.status_code == 400


async def test_ia_deshabilitada(api, ia_falsa, monkeypatch):
    monkeypatch.setattr(settings, "ia_habilitada", False)
    assert (await _post(api)).status_code == 503
    assert ia_falsa == []


async def test_ia_error_proveedor(api, monkeypatch):
    async def falla(*a, **k):
        raise RuntimeError("anthropic caído")

    monkeypatch.setattr(ia_router, "analizar_imagen", falla)
    r = await _post(api)
    assert r.status_code == 503
    assert "anthropic" not in r.text.lower()
