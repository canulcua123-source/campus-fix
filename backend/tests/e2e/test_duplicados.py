import asyncio
from datetime import datetime, timedelta, timezone
from io import BytesIO

import pytest
from bson import ObjectId
from PIL import Image

from app.core.config import settings
from app.services.vision.duplicados import (
    CoincidenciaNoElegible,
    buscar_por_huellas,
    calcular_huellas,
    confirmar_adhesion,
    detectar_duplicado,
    distancia_hamming,
    registrar_huella,
)

pytestmark = pytest.mark.e2e

AULA_A = "A" * 22
AULA_B = "B" * 22


def _imagen(*, inversa: bool = False, cambio_leve: bool = False) -> bytes:
    imagen = Image.new("L", (64, 64))
    for y in range(64):
        for x in range(64):
            valor = 255 - x * 4 if inversa else x * 4
            imagen.putpixel((x, y), max(0, min(valor, 255)))
    if cambio_leve:
        imagen.putpixel((32, 32), 0)
    salida = BytesIO()
    imagen.save(salida, format="PNG")
    return salida.getvalue()


@pytest.fixture(autouse=True)
async def _limpiar_colecciones(api):
    for nombre in ("huellas_reportes", "coincidencias_duplicados", "adhesiones_reportes"):
        await api.db[nombre].delete_many({})
    await api.db.aulas.delete_many({"id_publico": {"$in": [AULA_A, AULA_B]}})
    await api.db.aulas.insert_many(
        [
            {
                "id_publico": AULA_A,
                "edificio": "Edificio A",
                "piso": 1,
                "aula": "101",
                "activa": True,
                "fecha_creacion": datetime.now(timezone.utc),
            },
            {
                "id_publico": AULA_B,
                "edificio": "Edificio B",
                "piso": 1,
                "aula": "201",
                "activa": True,
                "fecha_creacion": datetime.now(timezone.utc),
            },
        ]
    )
    yield


def _usuario(api, quien: str) -> dict:
    return {**api.u[quien], "_alcance": "propio"}


async def _registrar_reporte(api, datos: bytes | None = None) -> tuple[dict, dict]:
    incidencia = await api.crear("reportante_a", edificio="Edificio A")
    huella = await registrar_huella(
        api.db,
        incidencia_id=ObjectId(incidencia["_id"]),
        aula_id=AULA_A,
        datos_imagen=datos or _imagen(),
        tipo_mime="image/png",
        usuario=_usuario(api, "reportante_a"),
    )
    return incidencia, huella


async def _detectar(api, datos: bytes | None = None, *, aula_id: str = AULA_A, categoria: str = "infraestructura", quien: str = "reportante_b", ahora: datetime | None = None):
    return await detectar_duplicado(
        api.db,
        datos_imagen=datos or _imagen(),
        tipo_mime="image/png",
        aula_id=aula_id,
        categoria=categoria,
        usuario_id=api.oid(quien),
        secreto=settings.jwt_secret,
        ahora=ahora,
    )


async def test_duplicado_exacto(api):
    incidencia, _ = await _registrar_reporte(api)
    cantidad_antes = await api.db.incidencias_campus.count_documents({})

    resultado = await _detectar(api)

    assert resultado is not None
    assert resultado.accion == "duplicado"
    assert resultado.codigo == incidencia["codigo"]
    assert await api.db.incidencias_campus.count_documents({}) == cantidad_antes


async def test_casi_duplicado(api):
    _, huella = await _registrar_reporte(api)
    modificada = _imagen(cambio_leve=True)
    nuevas = calcular_huellas(modificada, "image/png")
    assert nuevas.sha256 != huella["sha256"]
    assert distancia_hamming(nuevas.dhash, huella["dhash"]) <= 10

    resultado = await _detectar(api, modificada)

    assert resultado is not None
    assert resultado.accion == "duplicado"


async def test_otra_aula_no_dup(api):
    await _registrar_reporte(api)
    assert await _detectar(api, aula_id=AULA_B) is None


async def test_mas_24h_no_dup(api):
    _, huella = await _registrar_reporte(api)
    ahora = datetime.now(timezone.utc)
    await api.db.huellas_reportes.update_one(
        {"_id": huella["_id"]},
        {"$set": {"fecha": ahora - timedelta(hours=24, seconds=1)}},
    )

    assert await _detectar(api, ahora=ahora) is None


async def test_respuesta_sin_pii_ajena(api):
    await _registrar_reporte(api)
    resultado = await _detectar(api)
    assert resultado is not None

    cuerpo = resultado.model_dump()
    assert set(cuerpo) == {
        "accion",
        "coincidencia_id",
        "codigo",
        "categoria",
        "reportado_hace_minutos",
        "adhesiones",
    }
    serializado = str(cuerpo).lower()
    for prohibido in ("nombre", "correo", "usuario_id", "reportante", "descripcion", "foto", "evidencia", "token"):
        assert prohibido not in serializado


async def test_categoria_distinta_y_dhash_11_no_coinciden(api):
    ahora = datetime.now(timezone.utc)
    await api.db.huellas_reportes.insert_one(
        {
            "aula_id": AULA_A,
            "categoria": "infraestructura",
            "sha256": "a" * 64,
            "dhash": "0000000000000000",
            "incidencia_id": ObjectId(),
            "codigo": "INF-PRUEBA-1",
            "fecha": ahora,
            "elegible": True,
        }
    )
    assert await buscar_por_huellas(
        api.db,
        aula_id=AULA_A,
        categoria="academico",
        sha256="b" * 64,
        dhash="0000000000000000",
        ahora=ahora,
    ) is None
    assert await buscar_por_huellas(
        api.db,
        aula_id=AULA_A,
        categoria="infraestructura",
        sha256="b" * 64,
        dhash="00000000000007ff",
        ahora=ahora,
    ) is None


async def test_dhash_10_y_exactamente_24h_si_coinciden(api):
    ahora = datetime.now(timezone.utc)
    await api.db.huellas_reportes.insert_one(
        {
            "aula_id": AULA_A,
            "categoria": "infraestructura",
            "sha256": "a" * 64,
            "dhash": "0000000000000000",
            "incidencia_id": ObjectId(),
            "codigo": "INF-PRUEBA-2",
            "fecha": ahora - timedelta(hours=24),
            "elegible": True,
        }
    )
    resultado = await buscar_por_huellas(
        api.db,
        aula_id=AULA_A,
        categoria="infraestructura",
        sha256="b" * 64,
        dhash="00000000000003ff",
        ahora=ahora,
    )
    assert resultado is not None


async def test_confirmar_si_registra_una_adhesion_sin_ticket_nuevo(api):
    await _registrar_reporte(api)
    coincidencia = await _detectar(api)
    assert coincidencia is not None
    tickets_antes = await api.db.incidencias_campus.count_documents({})

    respuesta = await api.c.post(
        "/ia/duplicados/adhesiones",
        json={"coincidencia_id": coincidencia.coincidencia_id},
        headers=api.h("reportante_b"),
    )

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["adhesiones"] == 1
    assert respuesta.json()["registrada"] is True
    assert await api.db.incidencias_campus.count_documents({}) == tickets_antes


async def test_reintento_y_doble_clic_son_idempotentes(api):
    await _registrar_reporte(api)
    coincidencia = await _detectar(api)
    assert coincidencia is not None
    ruta = "/ia/duplicados/adhesiones"
    cuerpo = {"coincidencia_id": coincidencia.coincidencia_id}

    primera, segunda = await asyncio.gather(
        api.c.post(ruta, json=cuerpo, headers=api.h("reportante_b")),
        api.c.post(ruta, json=cuerpo, headers=api.h("reportante_b")),
    )
    assert primera.status_code == segunda.status_code == 200
    assert {primera.json()["registrada"], segunda.json()["registrada"]} == {True, False}
    assert await api.db.adhesiones_reportes.count_documents({}) == 1

    reintento = await api.c.post(ruta, json=cuerpo, headers=api.h("reportante_b"))
    assert reintento.status_code == 200
    assert reintento.json()["registrada"] is False
    assert reintento.json()["adhesiones"] == 1


async def test_coincidencia_no_es_transferible_ni_manipulable(api):
    await _registrar_reporte(api)
    coincidencia = await _detectar(api)
    assert coincidencia is not None

    ajena = await api.c.post(
        "/ia/duplicados/adhesiones",
        json={"coincidencia_id": coincidencia.coincidencia_id},
        headers=api.h("reportante_a"),
    )
    manipulada = await api.c.post(
        "/ia/duplicados/adhesiones",
        json={"coincidencia_id": "Z" * 43},
        headers=api.h("reportante_b"),
    )
    assert ajena.status_code == manipulada.status_code == 404
    assert await api.db.adhesiones_reportes.count_documents({}) == 0


async def test_coincidencia_expirada_no_admite_confirmacion(api):
    await _registrar_reporte(api)
    coincidencia = await _detectar(api)
    assert coincidencia is not None
    await api.db.coincidencias_duplicados.update_one(
        {"_id": coincidencia.coincidencia_id},
        {"$set": {"expira_en": datetime.now(timezone.utc) - timedelta(seconds=1)}},
    )

    respuesta = await api.c.post(
        "/ia/duplicados/adhesiones",
        json={"coincidencia_id": coincidencia.coincidencia_id},
        headers=api.h("reportante_b"),
    )
    assert respuesta.status_code == 404
    assert await api.db.adhesiones_reportes.count_documents({}) == 0


async def test_reporte_retirado_no_admite_adhesion(api):
    incidencia, huella = await _registrar_reporte(api)
    coincidencia = await _detectar(api)
    assert coincidencia is not None

    retirada = await api.c.post(f"/incidencias/{incidencia['_id']}/retirar", headers=api.h("reportante_a"))
    assert retirada.status_code == 200, retirada.text
    assert (await api.db.huellas_reportes.find_one({"_id": huella["_id"]}))["elegible"] is False

    respuesta = await api.c.post(
        "/ia/duplicados/adhesiones",
        json={"coincidencia_id": coincidencia.coincidencia_id},
        headers=api.h("reportante_b"),
    )
    assert respuesta.status_code == 409
    assert await api.db.adhesiones_reportes.count_documents({}) == 0


async def test_confirmacion_requiere_autenticacion_y_permisos(api):
    await _registrar_reporte(api)
    coincidencia = await _detectar(api)
    assert coincidencia is not None
    cuerpo = {"coincidencia_id": coincidencia.coincidencia_id}

    sin_auth = await api.c.post("/ia/duplicados/adhesiones", json=cuerpo)
    sin_permiso = await api.c.post("/ia/duplicados/adhesiones", json=cuerpo, headers=api.h("directivo"))
    assert sin_auth.status_code == 401
    assert sin_permiso.status_code == 403


async def test_confirmar_servicio_compensa_si_huella_expira(api):
    await _registrar_reporte(api)
    coincidencia = await _detectar(api)
    assert coincidencia is not None
    await api.db.huellas_reportes.delete_many({})

    with pytest.raises(CoincidenciaNoElegible):
        await confirmar_adhesion(
            api.db,
            coincidencia_id=coincidencia.coincidencia_id,
            usuario_id=api.oid("reportante_b"),
            secreto=settings.jwt_secret,
        )
    assert await api.db.adhesiones_reportes.count_documents({}) == 0


async def test_colecciones_t038_tienen_validadores_e_indices(api):
    cursor = await api.db.list_collections(
        filter={"name": {"$in": ["huellas_reportes", "coincidencias_duplicados", "adhesiones_reportes"]}}
    )
    opciones = {
        doc["name"]: doc["options"]
        async for doc in cursor
    }
    assert set(opciones) == {"huellas_reportes", "coincidencias_duplicados", "adhesiones_reportes"}
    for configuracion in opciones.values():
        assert configuracion["validationLevel"] == "strict"
        assert configuracion["validationAction"] == "error"
        assert configuracion["validator"]["$jsonSchema"]["additionalProperties"] is False

    huellas = await api.db.huellas_reportes.index_information()
    ttl = next(indice for indice in huellas.values() if indice.get("name") == "huellas_ttl_24h")
    assert ttl["expireAfterSeconds"] == 86400
    compuesto = huellas["huellas_aula_categoria_fecha"]["key"]
    assert compuesto == [("aula_id", 1), ("categoria", 1), ("fecha", -1)]
