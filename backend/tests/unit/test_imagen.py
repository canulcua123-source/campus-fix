from io import BytesIO

import pytest
from PIL import Image
from starlette.datastructures import UploadFile

from app.core.imagen import (
    FormatoImagenNoPermitido,
    ImagenDemasiadoGrande,
    ImagenNoProcesable,
    MAX_BYTES_IMAGEN,
    detectar_tipo_imagen,
    leer_y_validar_imagen,
    validar_imagen,
)


def _imagen(formato: str, ancho: int = 200, alto: int = 200) -> bytes:
    salida = BytesIO()
    Image.new("RGB", (ancho, alto), "white").save(salida, format=formato)
    return salida.getvalue()


def test_sniff_jpeg_png_webp():
    casos = (("JPEG", "image/jpeg"), ("PNG", "image/png"), ("WEBP", "image/webp"))
    for formato, mime in casos:
        datos = _imagen(formato)
        assert detectar_tipo_imagen(datos) == mime
        validada = validar_imagen(datos)
        assert (validada.tipo_mime, validada.ancho, validada.alto) == (mime, 200, 200)


def test_sniff_rechaza_ejecutable():
    with pytest.raises(FormatoImagenNoPermitido):
        detectar_tipo_imagen(b"MZ" + b"\0" * 100)


@pytest.mark.parametrize("lado", [200, 2600])
def test_dimensiones_limite_aceptadas(lado):
    validada = validar_imagen(_imagen("PNG", lado, 200))
    assert (validada.ancho, validada.alto) == (lado, 200)


@pytest.mark.parametrize("lado", [199, 2601])
def test_dimensiones_fuera_de_rango(lado):
    with pytest.raises(ImagenNoProcesable):
        validar_imagen(_imagen("PNG", lado, 200))


def test_imagen_corrupta_con_firma_valida():
    with pytest.raises(ImagenNoProcesable):
        validar_imagen(b"\x89PNG\r\n\x1a\ncontenido corrupto")


@pytest.mark.asyncio
async def test_limite_exacto_cinco_mb_y_un_byte_mas():
    datos = _imagen("PNG")
    exactos = datos + b"\0" * (MAX_BYTES_IMAGEN - len(datos))
    archivo = UploadFile(BytesIO(exactos))
    validada = await leer_y_validar_imagen(archivo)
    assert len(validada.datos) == MAX_BYTES_IMAGEN
    assert await archivo.read(8) == b"\x89PNG\r\n\x1a\n"

    con_un_byte_mas = UploadFile(BytesIO(exactos + b"\0"))
    with pytest.raises(ImagenDemasiadoGrande):
        await leer_y_validar_imagen(con_un_byte_mas)
