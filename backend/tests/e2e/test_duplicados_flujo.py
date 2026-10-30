"""T-033/T-038 conectados: la foto analizada deja huella al crear el reporte y G8 la encuentra después."""

from datetime import datetime, timezone
from io import BytesIO

import pytest
import pytest_asyncio
from bson import ObjectId
from PIL import Image

import app.routers.ia as ia_router
from app.core.db import get_redis
from app.schemas.ia import AnalisisImagen

from .helpers import cuerpo

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]

AULA = "Dup0Aula0Qr0Prueba0001"
AULA_OTRA = "Dup0Aula0Qr0Prueba0002"
EDIFICIO = "Edificio Duplicados"
EDIFICIO_OTRO = "Edificio Duplicados 2"
PROHIBIDOS = ("nombre", "correo", "usuario_id", "reportante", "descripcion", "evidencia", "sha256", "dhash", "huella")

INFRA = AnalisisImagen(
    es_incidencia_valida=True,
    categoria="infraestructura",
    titulo="Luminaria fundida",
    descripcion="Se observa una luminaria apagada en el aula",
    prioridad_sugerida="baja",
    tags=["luminaria"],
    campos_detectados=[],
    confianza=0.95,
    advertencias=[],
    detalle_infra={"tipo_dano": "luminaria", "riesgo_seguridad": "bajo"},
)
ACADEMICO = INFRA.model_copy(update={"categoria": "academico", "detalle_infra": None})


def _foto(*, inversa: bool = False, cambio_leve: bool = False) -> bytes:
    imagen = Image.new("L", (300, 300))
    for x in range(300):
        valor = 255 - x * 255 // 299 if inversa else x * 255 // 299
        for y in range(300):
            imagen.putpixel((x, y), valor)
    if cambio_leve:
        imagen.putpixel((150, 150), 0)
    salida = BytesIO()
    imagen.convert("RGB").save(salida, format="PNG")
    return salida.getvalue()


FOTO = _foto()


@pytest_asyncio.fixture(autouse=True, loop_scope="session")
async def entorno_duplicados(api):
    redis = get_redis()
    claves = [clave async for clave in redis.scan_iter(match="ia:*")]
    if claves:
        await redis.delete(*claves)
    huellas = [h async for h in api.db.huellas_reportes.find({"aula_id": {"$in": [AULA, AULA_OTRA]}})]
    if huellas:
        await api.db.adhesiones_reportes.delete_many({"incidencia_id": {"$in": [h["incidencia_id"] for h in huellas]}})
        await api.db.coincidencias_duplicados.delete_many({"huella_id": {"$in": [h["_id"] for h in huellas]}})
        await api.db.huellas_reportes.delete_many({"_id": {"$in": [h["_id"] for h in huellas]}})
    await api.db.aulas.delete_many({"id_publico": {"$in": [AULA, AULA_OTRA]}})
    ahora = datetime.now(timezone.utc)
    await api.db.aulas.insert_many(
        [
            {"id_publico": AULA, "edificio": EDIFICIO, "piso": 1, "aula": "101", "activa": True, "fecha_creacion": ahora},
            {
                "id_publico": AULA_OTRA,
                "edificio": EDIFICIO_OTRO,
                "piso": 1,
                "aula": "101",
                "activa": True,
                "fecha_creacion": ahora,
            },
        ]
    )
    yield


@pytest.fixture
def ia_falsa(monkeypatch):
    estado = {"analisis": INFRA}

    async def fake(datos, media_type, contexto=None):
        return estado["analisis"]

    monkeypatch.setattr(ia_router, "analizar_imagen", fake)
    return estado


async def _analizar(api, quien: str, foto: bytes = FOTO, aula_id: str | None = AULA):
    datos = {"aula_id": aula_id} if aula_id is not None else {}
    return await api.c.post(
        "/ia/analizar-imagen",
        files={"imagen": ("foto.png", foto, "image/png")},
        data=datos,
        headers=api.h(quien),
    )


async def _reportar_con_foto(api, quien: str = "reportante_a", edificio: str = EDIFICIO, aula_id: str = AULA) -> dict:
    r = await _analizar(api, quien, aula_id=aula_id)
    assert r.status_code == 200, r.text
    creada = await api.c.post(
        "/incidencias",
        json=cuerpo("infraestructura", edificio=edificio, analisis_id=r.json()["analisis_id"]),
        headers=api.h(quien),
    )
    assert creada.status_code == 201, creada.text
    return creada.json()


def _sin_pii(objeto) -> None:
    texto = str(objeto).lower()
    for prohibido in PROHIBIDOS:
        assert prohibido not in texto, prohibido


async def test_crear_con_foto_registra_huella_sin_datos_personales(api, ia_falsa):
    creada = await _reportar_con_foto(api)

    huella = await api.db.huellas_reportes.find_one({"incidencia_id": ObjectId(creada["_id"])})
    assert huella is not None
    assert huella["aula_id"] == AULA
    assert huella["categoria"] == "infraestructura"
    assert huella["codigo"] == creada["codigo"]
    assert huella["elegible"] is True
    assert set(huella) == {"_id", "aula_id", "categoria", "sha256", "dhash", "incidencia_id", "codigo", "fecha", "elegible"}


async def test_segundo_reporte_misma_foto_es_duplicado_y_adhesion_idempotente(api, ia_falsa):
    original = await _reportar_con_foto(api)
    total_incidencias = await api.db.incidencias_campus.count_documents({})

    r = await _analizar(api, "reportante_b")
    assert r.status_code == 200, r.text
    cuerpo_ia = r.json()
    assert cuerpo_ia["accion"] == "duplicado"
    duplicado = cuerpo_ia["duplicado"]
    assert duplicado["codigo"] == original["codigo"]
    assert duplicado["categoria"] == "infraestructura"
    assert 0 <= duplicado["reportado_hace_minutos"] <= 1
    assert duplicado["adhesiones"] == 0
    assert set(duplicado) == {"accion", "coincidencia_id", "codigo", "categoria", "reportado_hace_minutos", "adhesiones"}
    _sin_pii(duplicado)
    assert str(api.u["reportante_a"]["_id"]) not in r.text
    assert api.u["reportante_a"]["nombre"] not in r.text

    # El análisis guardado conserva la coincidencia para quien lo pidió.
    consulta = await api.c.get(f"/ia/analisis/{cuerpo_ia['analisis_id']}", headers=api.h("reportante_b"))
    assert consulta.json()["duplicado"]["coincidencia_id"] == duplicado["coincidencia_id"]

    adhesion = {"coincidencia_id": duplicado["coincidencia_id"], "analisis_id": cuerpo_ia["analisis_id"]}
    primera = await api.c.post("/ia/duplicados/adhesiones", json=adhesion, headers=api.h("reportante_b"))
    assert primera.status_code == 200, primera.text
    assert primera.json() == {
        "ok": True,
        "codigo": original["codigo"],
        "categoria": "infraestructura",
        "adhesiones": 1,
        "registrada": True,
    }
    repetida = await api.c.post("/ia/duplicados/adhesiones", json=adhesion, headers=api.h("reportante_b"))
    assert repetida.status_code == 200, repetida.text
    assert repetida.json()["registrada"] is False
    assert repetida.json()["adhesiones"] == 1

    filas = [f async for f in api.db.adhesiones_reportes.find({"incidencia_id": ObjectId(original["_id"])})]
    assert len(filas) == 1
    assert set(filas[0]) == {"_id", "incidencia_id", "codigo", "categoria", "fecha"}
    _sin_pii({k: v for k, v in filas[0].items() if k != "_id"})
    assert await api.db.incidencias_campus.count_documents({}) == total_incidencias

    oferta = await api.db.ia_eventos.find_one({"analisis_id": cuerpo_ia["analisis_id"]})
    assert oferta["resultado_final"] == "duplicado_sumado"

    # La coincidencia es del actor que la recibió: otra persona no puede usarla.
    ajena = await api.c.post(
        "/ia/duplicados/adhesiones", json={"coincidencia_id": duplicado["coincidencia_id"]}, headers=api.h("reportante_a")
    )
    assert ajena.status_code == 404


async def test_foto_casi_igual_tambien_es_duplicado(api, ia_falsa):
    original = await _reportar_con_foto(api)
    r = await _analizar(api, "reportante_b", foto=_foto(cambio_leve=True))
    assert r.status_code == 200, r.text
    assert r.json()["accion"] == "duplicado"
    assert r.json()["duplicado"]["codigo"] == original["codigo"]


async def test_otra_aula_otra_categoria_u_otra_foto_no_son_duplicado(api, ia_falsa):
    await _reportar_con_foto(api)

    otra_aula = await _analizar(api, "reportante_b", aula_id=AULA_OTRA)
    assert otra_aula.json()["accion"] != "duplicado"
    assert "duplicado" not in otra_aula.json()

    otra_foto = await _analizar(api, "reportante_b", foto=_foto(inversa=True))
    assert otra_foto.json()["accion"] != "duplicado"

    ia_falsa["analisis"] = ACADEMICO
    redis = get_redis()
    await redis.delete(*[clave async for clave in redis.scan_iter(match="ia:cache:*")])
    otra_categoria = await _analizar(api, "reportante_b")
    assert otra_categoria.status_code == 200, otra_categoria.text
    assert otra_categoria.json()["accion"] != "duplicado"


async def test_sin_aula_no_busca_duplicados(api, ia_falsa):
    await _reportar_con_foto(api)
    r = await _analizar(api, "reportante_b", aula_id=None)
    assert r.status_code == 200, r.text
    assert r.json()["accion"] == "formulario"
    assert "duplicado" not in r.json()


async def test_aula_id_invalido_responde_400(api, ia_falsa):
    r = await _analizar(api, "reportante_b", aula_id="no-es/un-id")
    assert r.status_code == 400, r.text


async def test_reporte_resuelto_deja_de_ser_duplicado(api, ia_falsa):
    original = await _reportar_con_foto(api)
    await api.a_estado(original["_id"], "resuelta")
    r = await _analizar(api, "reportante_b")
    assert r.json()["accion"] != "duplicado"


async def test_falla_de_huellas_no_rompe_el_analisis(api, ia_falsa, monkeypatch):
    await _reportar_con_foto(api)

    async def caida(*_args, **_kwargs):
        raise RuntimeError("Mongo no disponible")

    monkeypatch.setattr(ia_router, "detectar_duplicado_por_huellas", caida)
    r = await _analizar(api, "reportante_b")
    assert r.status_code == 200, r.text
    assert r.json()["accion"] == "formulario"


async def test_ubicacion_fuera_del_catalogo_crea_sin_huella(api, ia_falsa):
    r = await _analizar(api, "reportante_a")
    creada = await api.c.post(
        "/incidencias",
        json=cuerpo("infraestructura", edificio="Edificio Sin Catalogo", analisis_id=r.json()["analisis_id"]),
        headers=api.h("reportante_a"),
    )
    assert creada.status_code == 201, creada.text
    assert await api.db.huellas_reportes.count_documents({"incidencia_id": ObjectId(creada.json()["_id"])}) == 0


async def test_crear_sin_analisis_no_registra_huella(api):
    creada = await api.crear("reportante_a", edificio=EDIFICIO)
    assert await api.db.huellas_reportes.count_documents({"incidencia_id": ObjectId(creada["_id"])}) == 0
