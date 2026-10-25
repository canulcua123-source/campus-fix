from datetime import datetime, timedelta, timezone
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from bson import ObjectId
from PIL import Image
from pymongo.errors import DuplicateKeyError

from app.services.vision.duplicados import (
    CoincidenciaNoElegible,
    CoincidenciaNoEncontrada,
    buscar_por_huellas,
    confirmar_adhesion,
    detectar_duplicado,
    registrar_huella,
)

AULA_ID = "A" * 22
SECRETO = "s" * 64


def _png() -> bytes:
    imagen = Image.new("L", (16, 16))
    for y in range(16):
        for x in range(16):
            imagen.putpixel((x, y), x * 16)
    salida = BytesIO()
    imagen.save(salida, format="PNG")
    return salida.getvalue()


class CursorFalso:
    def __init__(self, documentos):
        self.documentos = documentos

    def sort(self, *_args):
        return self

    def __aiter__(self):
        async def iterador():
            for documento in self.documentos:
                yield documento

        return iterador()


def _huella(ahora: datetime, *, dhash: str = "0000000000000000") -> dict:
    return {
        "_id": ObjectId(),
        "aula_id": AULA_ID,
        "categoria": "infraestructura",
        "sha256": "a" * 64,
        "dhash": dhash,
        "incidencia_id": ObjectId(),
        "codigo": "INF-PRUEBA-1",
        "fecha": ahora - timedelta(minutes=5),
        "elegible": True,
    }


@pytest.mark.asyncio
async def test_busqueda_exacta_solo_usa_huellas_y_filtro_temporal():
    ahora = datetime.now(timezone.utc)
    documento = _huella(ahora)
    coleccion = SimpleNamespace(find_one=AsyncMock(return_value=documento))
    db = SimpleNamespace(huellas_reportes=coleccion)

    resultado = await buscar_por_huellas(
        db,
        aula_id=AULA_ID,
        categoria="infraestructura",
        sha256="a" * 64,
        dhash="f" * 16,
        ahora=ahora,
    )

    assert resultado == documento
    filtro = coleccion.find_one.await_args.args[0]
    assert filtro["elegible"] is True
    assert filtro["fecha"] == {"$gte": ahora - timedelta(hours=24), "$lte": ahora}
    assert not hasattr(db, "incidencias_campus")


@pytest.mark.asyncio
async def test_busqueda_perceptual_incluye_10_y_excluye_11():
    ahora = datetime.now(timezone.utc)
    coleccion = SimpleNamespace(
        find_one=AsyncMock(return_value=None),
        find=lambda *_args: CursorFalso([_huella(ahora)]),
    )
    db = SimpleNamespace(huellas_reportes=coleccion)

    dentro = await buscar_por_huellas(
        db,
        aula_id=AULA_ID,
        categoria="infraestructura",
        sha256="b" * 64,
        dhash="00000000000003ff",
        ahora=ahora,
    )
    fuera = await buscar_por_huellas(
        db,
        aula_id=AULA_ID,
        categoria="infraestructura",
        sha256="b" * 64,
        dhash="00000000000007ff",
        ahora=ahora,
    )
    assert dentro is not None
    assert fuera is None


@pytest.mark.asyncio
async def test_detectar_emite_capacidad_opaca_y_respuesta_sin_pii():
    ahora = datetime.now(timezone.utc)
    documento = _huella(ahora)
    db = SimpleNamespace(
        huellas_reportes=SimpleNamespace(find_one=AsyncMock(return_value=documento)),
        coincidencias_duplicados=SimpleNamespace(insert_one=AsyncMock()),
        adhesiones_reportes=SimpleNamespace(count_documents=AsyncMock(return_value=0)),
    )

    resultado = await detectar_duplicado(
        db,
        datos_imagen=_png(),
        tipo_mime="image/png",
        aula_id=AULA_ID,
        categoria="infraestructura",
        usuario_id=ObjectId(),
        secreto=SECRETO,
        ahora=ahora,
    )

    assert resultado is not None
    cuerpo = resultado.model_dump()
    assert len(cuerpo["coincidencia_id"]) == 43
    assert set(cuerpo) == {
        "accion", "coincidencia_id", "codigo", "categoria", "reportado_hace_minutos", "adhesiones",
    }
    guardado = db.coincidencias_duplicados.insert_one.await_args.args[0]
    assert "usuario_id" not in guardado
    assert "actor_clave" in guardado


def _db_confirmacion(ahora: datetime, *, insercion=None, vigente: int = 1):
    huella = _huella(ahora)
    coincidencia = {
        "_id": "A" * 43,
        "huella_id": huella["_id"],
        "expira_en": ahora + timedelta(minutes=10),
    }
    insert_one = AsyncMock(side_effect=insercion)
    return SimpleNamespace(
        coincidencias_duplicados=SimpleNamespace(find_one=AsyncMock(return_value=coincidencia)),
        huellas_reportes=SimpleNamespace(
            find_one=AsyncMock(return_value=huella),
            count_documents=AsyncMock(return_value=vigente),
        ),
        adhesiones_reportes=SimpleNamespace(
            insert_one=insert_one,
            delete_one=AsyncMock(),
            count_documents=AsyncMock(return_value=1),
        ),
    )


@pytest.mark.asyncio
async def test_adhesion_guarda_hmac_sin_usuario_y_reintento_no_incrementa():
    ahora = datetime.now(timezone.utc)
    usuario_id = ObjectId()
    db = _db_confirmacion(ahora)

    primera = await confirmar_adhesion(
        db,
        coincidencia_id="A" * 43,
        usuario_id=usuario_id,
        secreto=SECRETO,
        ahora=ahora,
    )
    guardada = db.adhesiones_reportes.insert_one.await_args.args[0]
    assert primera.registrada is True
    assert len(guardada["_id"]) == 64
    assert "usuario_id" not in guardada

    db.adhesiones_reportes.insert_one.side_effect = DuplicateKeyError("duplicada")
    segunda = await confirmar_adhesion(
        db,
        coincidencia_id="A" * 43,
        usuario_id=usuario_id,
        secreto=SECRETO,
        ahora=ahora,
    )
    assert segunda.registrada is False
    assert segunda.adhesiones == 1


@pytest.mark.asyncio
async def test_adhesion_compensa_si_reporte_deja_de_ser_elegible():
    ahora = datetime.now(timezone.utc)
    db = _db_confirmacion(ahora, vigente=0)

    with pytest.raises(CoincidenciaNoElegible):
        await confirmar_adhesion(
            db,
            coincidencia_id="A" * 43,
            usuario_id=ObjectId(),
            secreto=SECRETO,
            ahora=ahora,
        )
    db.adhesiones_reportes.delete_one.assert_awaited_once()


@pytest.mark.asyncio
async def test_coincidencia_ajena_o_expirada_es_indistinguible():
    ahora = datetime.now(timezone.utc)
    db = _db_confirmacion(ahora)
    db.coincidencias_duplicados.find_one.return_value = None

    with pytest.raises(CoincidenciaNoEncontrada):
        await confirmar_adhesion(
            db,
            coincidencia_id="Z" * 43,
            usuario_id=ObjectId(),
            secreto=SECRETO,
            ahora=ahora,
        )
    db.adhesiones_reportes.insert_one.assert_not_awaited()


@pytest.mark.asyncio
async def test_registro_verifica_incidencia_en_alcance_y_aula_activa():
    ahora = datetime.now(timezone.utc)
    incidencia_id = ObjectId()
    incidencia = {
        "_id": incidencia_id,
        "codigo": "INF-PRUEBA-2",
        "categoria": "infraestructura",
        "estado": "abierta",
        "ubicacion": {"edificio": "A", "piso": 1, "aula": "101"},
        "fecha_creacion": ahora,
    }
    aula = {"edificio": "A", "piso": 1, "aula": "101"}
    guardada = {"_id": ObjectId(), "incidencia_id": incidencia_id}
    db = SimpleNamespace(
        incidencias_campus=SimpleNamespace(find_one=AsyncMock(return_value=incidencia)),
        aulas=SimpleNamespace(find_one=AsyncMock(return_value=aula)),
        huellas_reportes=SimpleNamespace(update_one=AsyncMock(), find_one=AsyncMock(return_value=guardada)),
    )
    usuario_id = ObjectId()

    resultado = await registrar_huella(
        db,
        incidencia_id=incidencia_id,
        aula_id=AULA_ID,
        datos_imagen=_png(),
        tipo_mime="image/png",
        usuario={"_id": usuario_id, "_alcance": "propio"},
    )

    assert resultado == guardada
    filtro = db.incidencias_campus.find_one.await_args.args[0]
    assert filtro == {"_id": incidencia_id, "reportante.usuario_id": usuario_id}
    db.huellas_reportes.update_one.assert_awaited_once()
