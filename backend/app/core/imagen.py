import asyncio
import warnings
from dataclasses import dataclass
from io import BytesIO
from typing import Literal, Protocol

from PIL import Image, UnidentifiedImageError

TipoMimeImagen = Literal["image/jpeg", "image/png", "image/webp"]

MAX_BYTES_IMAGEN = 5 * 1024 * 1024
MIN_LADO_IMAGEN = 200
MAX_LADO_IMAGEN = 2600
TAMANO_BLOQUE = 64 * 1024


class ArchivoAsync(Protocol):
    async def read(self, size: int = -1) -> bytes: ...

    async def seek(self, offset: int) -> None: ...


class ErrorImagen(Exception):
    """Error esperado al validar una imagen recibida del cliente."""


class ImagenDemasiadoGrande(ErrorImagen):
    pass


class FormatoImagenNoPermitido(ErrorImagen):
    pass


class ImagenNoProcesable(ErrorImagen):
    pass


@dataclass(frozen=True, slots=True)
class ImagenValidada:
    datos: bytes
    tipo_mime: TipoMimeImagen
    ancho: int
    alto: int


def detectar_tipo_imagen(datos: bytes) -> TipoMimeImagen:
    if datos.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if datos.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(datos) >= 12 and datos.startswith(b"RIFF") and datos[8:12] == b"WEBP":
        return "image/webp"
    raise FormatoImagenNoPermitido


def validar_imagen(datos: bytes) -> ImagenValidada:
    tipo_mime = detectar_tipo_imagen(datos)
    formatos_por_mime = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(datos)) as imagen:
                ancho, alto = imagen.size
                if imagen.format != formatos_por_mime[tipo_mime]:
                    raise ImagenNoProcesable
                if not (MIN_LADO_IMAGEN <= ancho <= MAX_LADO_IMAGEN):
                    raise ImagenNoProcesable
                if not (MIN_LADO_IMAGEN <= alto <= MAX_LADO_IMAGEN):
                    raise ImagenNoProcesable
                imagen.verify()

            # Pillow recomienda abrir de nuevo después de verify(); load() fuerza la
            # decodificación completa para detectar contenido truncado o corrupto.
            with Image.open(BytesIO(datos)) as imagen:
                imagen.load()
    except ImagenNoProcesable:
        raise
    except (
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        UnidentifiedImageError,
        OSError,
        ValueError,
    ) as exc:
        raise ImagenNoProcesable from exc

    return ImagenValidada(datos=datos, tipo_mime=tipo_mime, ancho=ancho, alto=alto)


async def leer_y_validar_imagen(archivo: ArchivoAsync, max_bytes: int = MAX_BYTES_IMAGEN) -> ImagenValidada:
    fragmentos: list[bytes] = []
    total = 0
    try:
        while True:
            bloque = await archivo.read(min(TAMANO_BLOQUE, max_bytes - total + 1))
            if not bloque:
                break
            total += len(bloque)
            if total > max_bytes:
                raise ImagenDemasiadoGrande
            fragmentos.append(bloque)
    finally:
        await archivo.seek(0)

    # verify()/load() de Pillow son CPU-bound: en un hilo para no bloquear el event loop.
    return await asyncio.to_thread(validar_imagen, b"".join(fragmentos))
