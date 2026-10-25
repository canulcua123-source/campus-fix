from datetime import datetime, timedelta, timezone
from io import BytesIO

import pytest
from PIL import Image

from app.services.vision.duplicados import (
    MAX_BYTES_IMAGEN,
    ImagenHuellaInvalida,
    calcular_dhash,
    calcular_huellas,
    calcular_sha256,
    distancia_hamming,
    dentro_ventana_24h,
    validar_dhash,
    validar_sha256,
)


def _imagen_gradiente(*, inversa: bool = False, formato: str = "PNG", exif: Image.Exif | None = None) -> bytes:
    imagen = Image.new("L", (64, 64))
    for y in range(64):
        for x in range(64):
            valor = 255 - x * 4 if inversa else x * 4
            imagen.putpixel((x, y), max(0, min(valor, 255)))
    salida = BytesIO()
    imagen.save(salida, format=formato, exif=exif)
    return salida.getvalue()


def test_sha256_es_determinista_y_hexadecimal():
    primero = calcular_sha256(b"imagen-controlada")
    assert primero == calcular_sha256(b"imagen-controlada")
    assert primero != calcular_sha256(b"otra-imagen")
    assert len(primero) == 64
    assert validar_sha256(primero) == primero


@pytest.mark.parametrize(
    "datos",
    [b"", b"x" * (MAX_BYTES_IMAGEN + 1)],
    ids=["vacia", "mayor_5mb"],
)
def test_sha256_rechaza_entrada_vacia_o_excesiva(datos):
    with pytest.raises(ImagenHuellaInvalida):
        calcular_sha256(datos)


def test_dhash_misma_imagen_y_cambio_leve():
    datos = _imagen_gradiente()
    imagen = Image.open(BytesIO(datos)).convert("L")
    imagen.putpixel((32, 32), 0)
    salida = BytesIO()
    imagen.save(salida, format="PNG")

    original = calcular_dhash(datos, "image/png")
    leve = calcular_dhash(salida.getvalue(), "image/png")
    assert calcular_dhash(datos, "image/png") == original
    assert distancia_hamming(original, leve) <= 10


def test_dhash_distingue_imagen_visual_inversa():
    normal = calcular_dhash(_imagen_gradiente(), "image/png")
    inversa = calcular_dhash(_imagen_gradiente(inversa=True), "image/png")
    assert distancia_hamming(normal, inversa) > 10


def test_dhash_normaliza_orientacion_exif():
    exif = Image.Exif()
    exif[274] = 6
    huella = calcular_dhash(_imagen_gradiente(formato="JPEG", exif=exif), "image/jpeg")
    assert len(huella) == 16
    assert validar_dhash(huella) == huella


@pytest.mark.parametrize(
    ("datos", "mime"),
    [
        (b"no-es-imagen", "image/png"),
        (b"GIF89a" + b"0" * 20, "image/gif"),
        (_imagen_gradiente(), "image/jpeg"),
    ],
    ids=["corrupta", "formato-no-permitido", "mime-no-coincide"],
)
def test_dhash_rechaza_imagen_invalida(datos, mime):
    with pytest.raises(ImagenHuellaInvalida):
        calcular_dhash(datos, mime)


def test_huellas_combinadas_tienen_formato_estable():
    huellas = calcular_huellas(_imagen_gradiente(), "image/png")
    assert validar_sha256(huellas.sha256) == huellas.sha256
    assert validar_dhash(huellas.dhash) == huellas.dhash


@pytest.mark.parametrize(
    ("a", "b", "esperada"),
    [
        ("0000000000000000", "0000000000000000", 0),
        ("0000000000000000", "00000000000003ff", 10),
        ("0000000000000000", "00000000000007ff", 11),
    ],
)
def test_distancia_hamming_limites(a, b, esperada):
    assert distancia_hamming(a, b) == esperada


@pytest.mark.parametrize("valor", ["", "ABC", "g" * 64, "a" * 63, "A" * 64])
def test_validacion_rechaza_sha256_invalido(valor):
    with pytest.raises(ValueError):
        validar_sha256(valor)


@pytest.mark.parametrize("valor", ["", "xyz", "0" * 15, "F" * 16])
def test_validacion_rechaza_dhash_invalido(valor):
    with pytest.raises(ValueError):
        validar_dhash(valor)


def test_ventana_incluye_exactamente_24_horas_y_excluye_mas():
    ahora = datetime(2026, 10, 25, 12, tzinfo=timezone.utc)
    assert dentro_ventana_24h(ahora, ahora)
    assert dentro_ventana_24h(ahora - timedelta(hours=24), ahora)
    assert not dentro_ventana_24h(ahora - timedelta(hours=24, microseconds=1), ahora)
    assert not dentro_ventana_24h(ahora + timedelta(microseconds=1), ahora)


def test_ventana_rechaza_fecha_sin_zona_horaria():
    with pytest.raises(ValueError, match="zona horaria"):
        dentro_ventana_24h(datetime(2026, 10, 25), datetime.now(timezone.utc))
