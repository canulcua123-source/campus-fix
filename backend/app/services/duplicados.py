"""Deteccion privada de duplicados y adhesiones idempotentes para T-038.

``POST /ia/analizar-imagen`` calcula las huellas de la imagen recibida por el
servidor, consulta G8 con ``detectar_duplicado_por_huellas`` y las guarda en el
analisis temporal; ``POST /incidencias`` las registra con
``registrar_huella_calculada`` al crear el reporte. Este modulo nunca consulta incidencias ajenas para
buscar coincidencias: esa busqueda se limita a ``huellas_reportes``.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import warnings
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from io import BytesIO
from typing import Any

from bson import ObjectId
from PIL import Image, ImageOps, UnidentifiedImageError
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from app.core.security import filtro_alcance
from app.schemas.duplicado import AdhesionOut, PosibleDuplicadoOut

MAX_BYTES_IMAGEN = 5 * 1024 * 1024
VENTANA_DUPLICADOS = timedelta(hours=24)
TTL_COINCIDENCIA = timedelta(minutes=30)
DISTANCIA_DHASH_MAXIMA = 10
ESTADOS_ELEGIBLES = frozenset({"abierta", "en_proceso", "en_espera"})
FORMATOS_IMAGEN = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
PATRON_SHA256 = re.compile(r"^[0-9a-f]{64}$")
PATRON_DHASH = re.compile(r"^[0-9a-f]{16}$")
PATRON_AULA = re.compile(r"^[A-Za-z0-9_-]{22}$")
PATRON_CATEGORIA = re.compile(r"^[a-z][a-z0-9_]{2,29}$")


class ImagenHuellaInvalida(ValueError):
    """La imagen no puede procesarse de forma segura y determinista."""


class RegistroHuellaInvalido(ValueError):
    """La incidencia o el aula no permiten registrar una huella."""


class CoincidenciaNoEncontrada(LookupError):
    """La coincidencia no existe, expiro o pertenece a otro usuario."""


class CoincidenciaNoElegible(RuntimeError):
    """El reporte dejo de admitir nuevas adhesiones."""


@dataclass(frozen=True, slots=True)
class HuellasImagen:
    sha256: str
    dhash: str


def _fecha_utc(fecha: datetime, campo: str) -> datetime:
    if fecha.tzinfo is None or fecha.utcoffset() is None:
        raise ValueError(f"{campo} debe incluir zona horaria")
    return fecha.astimezone(timezone.utc)


def _validar_bytes(datos: bytes) -> bytes:
    if not isinstance(datos, bytes):
        raise ImagenHuellaInvalida("La imagen debe recibirse como bytes")
    if not datos:
        raise ImagenHuellaInvalida("La imagen esta vacia")
    if len(datos) > MAX_BYTES_IMAGEN:
        raise ImagenHuellaInvalida("La imagen excede 5 MB")
    return datos


def calcular_sha256(datos: bytes) -> str:
    """Calcula SHA-256 sobre los bytes recibidos por el servidor."""
    return hashlib.sha256(_validar_bytes(datos)).hexdigest()


def calcular_dhash(datos: bytes, tipo_mime: str | None = None) -> str:
    """Calcula dHash horizontal de 64 bits sobre una imagen normalizada."""
    datos = _validar_bytes(datos)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(datos)) as imagen:
                formato = imagen.format
                if formato not in FORMATOS_IMAGEN:
                    raise ImagenHuellaInvalida("Formato no permitido (usa JPEG, PNG o WebP)")
                if tipo_mime is not None and FORMATOS_IMAGEN[formato] != tipo_mime:
                    raise ImagenHuellaInvalida("El contenido de la imagen no coincide con su tipo MIME")
                imagen.verify()
            with Image.open(BytesIO(datos)) as imagen:
                normalizada = ImageOps.exif_transpose(imagen).convert("L")
                reducida = normalizada.resize((9, 8), Image.Resampling.LANCZOS)
                pixeles = list(reducida.get_flattened_data())
    except ImagenHuellaInvalida:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning, UnidentifiedImageError, OSError) as exc:
        raise ImagenHuellaInvalida("La imagen es invalida o esta corrupta") from exc

    bits = 0
    for fila in range(8):
        inicio = fila * 9
        for columna in range(8):
            bits = (bits << 1) | int(pixeles[inicio + columna] > pixeles[inicio + columna + 1])
    return f"{bits:016x}"


def calcular_huellas(datos: bytes, tipo_mime: str | None = None) -> HuellasImagen:
    return HuellasImagen(sha256=calcular_sha256(datos), dhash=calcular_dhash(datos, tipo_mime))


def validar_sha256(valor: str) -> str:
    if not isinstance(valor, str) or PATRON_SHA256.fullmatch(valor) is None:
        raise ValueError("sha256 debe contener 64 caracteres hexadecimales en minusculas")
    return valor


def validar_dhash(valor: str) -> str:
    if not isinstance(valor, str) or PATRON_DHASH.fullmatch(valor) is None:
        raise ValueError("dhash debe contener 16 caracteres hexadecimales en minusculas")
    return valor


def distancia_hamming(dhash_a: str, dhash_b: str) -> int:
    a = int(validar_dhash(dhash_a), 16)
    b = int(validar_dhash(dhash_b), 16)
    return (a ^ b).bit_count()


def dentro_ventana_24h(fecha: datetime, ahora: datetime | None = None) -> bool:
    ahora_utc = _fecha_utc(ahora or datetime.now(timezone.utc), "ahora")
    fecha_utc = _fecha_utc(fecha, "fecha")
    return ahora_utc - VENTANA_DUPLICADOS <= fecha_utc <= ahora_utc


def _validar_contexto(aula_id: str, categoria: str) -> None:
    if not isinstance(aula_id, str) or PATRON_AULA.fullmatch(aula_id) is None:
        raise ValueError("aula_id no tiene el formato esperado")
    if not isinstance(categoria, str) or PATRON_CATEGORIA.fullmatch(categoria) is None:
        raise ValueError("categoria no tiene el formato esperado")


def _clave_actor(usuario_id: ObjectId, secreto: str) -> str:
    return hmac.new(secreto.encode(), f"duplicados:{usuario_id}".encode(), hashlib.sha256).hexdigest()


def _clave_adhesion(usuario_id: ObjectId, incidencia_id: ObjectId, secreto: str) -> str:
    mensaje = f"adhesion:{incidencia_id}:{usuario_id}".encode()
    return hmac.new(secreto.encode(), mensaje, hashlib.sha256).hexdigest()


async def buscar_por_huellas(
    db: AsyncDatabase,
    *,
    aula_id: str,
    categoria: str,
    sha256: str,
    dhash: str,
    ahora: datetime | None = None,
) -> dict[str, Any] | None:
    """Busca solo en huellas_reportes y aplica una ventana explicita de 24 h."""
    _validar_contexto(aula_id, categoria)
    validar_sha256(sha256)
    validar_dhash(dhash)
    instante = _fecha_utc(ahora or datetime.now(timezone.utc), "ahora")
    base = {
        "aula_id": aula_id,
        "categoria": categoria,
        "elegible": True,
        "fecha": {"$gte": instante - VENTANA_DUPLICADOS, "$lte": instante},
    }
    proyeccion = {"codigo": 1, "categoria": 1, "sha256": 1, "dhash": 1, "incidencia_id": 1, "fecha": 1}
    exacta = await db.huellas_reportes.find_one({**base, "sha256": sha256}, proyeccion, sort=[("fecha", -1)])
    if exacta is not None:
        return exacta
    cursor = db.huellas_reportes.find(base, proyeccion).sort("fecha", -1)
    async for candidata in cursor:
        if distancia_hamming(dhash, candidata["dhash"]) <= DISTANCIA_DHASH_MAXIMA:
            return candidata
    return None


async def _crear_coincidencia(
    db: AsyncDatabase,
    huella: Mapping[str, Any],
    usuario_id: ObjectId,
    secreto: str,
    ahora: datetime,
) -> PosibleDuplicadoOut:
    expira_en = min(ahora + TTL_COINCIDENCIA, huella["fecha"] + VENTANA_DUPLICADOS)
    for _ in range(3):
        token = secrets.token_urlsafe(32)
        try:
            await db.coincidencias_duplicados.insert_one(
                {
                    "_id": token,
                    "huella_id": huella["_id"],
                    "actor_clave": _clave_actor(usuario_id, secreto),
                    "fecha": ahora,
                    "expira_en": expira_en,
                }
            )
            break
        except DuplicateKeyError:
            continue
    else:
        raise RuntimeError("No fue posible emitir una coincidencia segura")
    adhesiones = await db.adhesiones_reportes.count_documents({"incidencia_id": huella["incidencia_id"]})
    minutos = max(0, int((ahora - huella["fecha"]).total_seconds() // 60))
    return PosibleDuplicadoOut(
        accion="duplicado",
        coincidencia_id=token,
        codigo=huella["codigo"],
        categoria=huella["categoria"],
        reportado_hace_minutos=min(minutos, 1440),
        adhesiones=adhesiones,
    )


async def detectar_duplicado(
    db: AsyncDatabase,
    *,
    datos_imagen: bytes,
    tipo_mime: str,
    aula_id: str,
    categoria: str,
    usuario_id: ObjectId,
    secreto: str,
    ahora: datetime | None = None,
) -> PosibleDuplicadoOut | None:
    """Calcula las huellas de la imagen recibida por el servidor y busca una coincidencia (G8)."""
    return await detectar_duplicado_por_huellas(
        db,
        huellas=calcular_huellas(datos_imagen, tipo_mime),
        aula_id=aula_id,
        categoria=categoria,
        usuario_id=usuario_id,
        secreto=secreto,
        ahora=ahora,
    )


async def detectar_duplicado_por_huellas(
    db: AsyncDatabase,
    *,
    huellas: HuellasImagen,
    aula_id: str,
    categoria: str,
    usuario_id: ObjectId,
    secreto: str,
    ahora: datetime | None = None,
) -> PosibleDuplicadoOut | None:
    """G8 con huellas ya calculadas en ``POST /ia/analizar-imagen`` (evita decodificar la imagen dos veces)."""
    instante = _fecha_utc(ahora or datetime.now(timezone.utc), "ahora")
    coincidencia = await buscar_por_huellas(
        db,
        aula_id=aula_id,
        categoria=categoria,
        sha256=huellas.sha256,
        dhash=huellas.dhash,
        ahora=instante,
    )
    if coincidencia is None:
        return None
    return await _crear_coincidencia(db, coincidencia, usuario_id, secreto, instante)


async def registrar_huella(
    db: AsyncDatabase,
    *,
    incidencia_id: ObjectId,
    aula_id: str,
    datos_imagen: bytes,
    tipo_mime: str,
    usuario: dict[str, Any],
) -> dict[str, Any]:
    """Registra una huella solo para una incidencia legitima dentro del alcance del actor."""
    return await registrar_huella_calculada(
        db,
        incidencia_id=incidencia_id,
        aula_id=aula_id,
        huellas=calcular_huellas(datos_imagen, tipo_mime),
        usuario=usuario,
    )


async def registrar_huella_calculada(
    db: AsyncDatabase,
    *,
    incidencia_id: ObjectId,
    aula_id: str,
    huellas: HuellasImagen,
    usuario: dict[str, Any],
) -> dict[str, Any]:
    """Como ``registrar_huella``, con las huellas que el servidor calculo al analizar la foto."""
    validar_sha256(huellas.sha256)
    validar_dhash(huellas.dhash)
    if not isinstance(incidencia_id, ObjectId):
        raise RegistroHuellaInvalido("incidencia_id no es valido")
    incidencia = await db.incidencias_campus.find_one(
        {"_id": incidencia_id, **filtro_alcance(usuario)},
        {"codigo": 1, "categoria": 1, "estado": 1, "ubicacion": 1, "fecha_creacion": 1},
    )
    if incidencia is None:
        raise RegistroHuellaInvalido("Incidencia inexistente o fuera de alcance")
    if incidencia.get("estado") not in ESTADOS_ELEGIBLES:
        raise RegistroHuellaInvalido("La incidencia no admite una huella activa")
    categoria = incidencia.get("categoria")
    _validar_contexto(aula_id, categoria)
    aula = await db.aulas.find_one({"id_publico": aula_id, "activa": True}, {"edificio": 1, "piso": 1, "aula": 1})
    if aula is None or any(
        incidencia.get("ubicacion", {}).get(campo) != aula[campo] for campo in ("edificio", "piso", "aula")
    ):
        raise RegistroHuellaInvalido("El aula no corresponde a la ubicacion de la incidencia")
    fecha = _fecha_utc(incidencia["fecha_creacion"], "fecha_creacion")
    documento = {
        "aula_id": aula_id,
        "categoria": categoria,
        "sha256": huellas.sha256,
        "dhash": huellas.dhash,
        "incidencia_id": incidencia_id,
        "codigo": incidencia["codigo"],
        "fecha": fecha,
        "elegible": True,
    }
    await db.huellas_reportes.update_one(
        {"incidencia_id": incidencia_id},
        {"$setOnInsert": documento},
        upsert=True,
    )
    registrada = await db.huellas_reportes.find_one({"incidencia_id": incidencia_id})
    if registrada is None:
        raise RuntimeError("No fue posible registrar la huella")
    return registrada


async def actualizar_elegibilidad_huella(db: AsyncDatabase, incidencia_id: ObjectId, estado: str) -> None:
    """Sincroniza el estado publico minimo sin leer la incidencia ni sus datos privados."""
    coleccion = getattr(db, "huellas_reportes", None)
    if coleccion is None:
        # Dobles unitarios de tareas anteriores modelan solo incidencias_campus.
        return
    await coleccion.update_one(
        {"incidencia_id": incidencia_id},
        {"$set": {"elegible": estado in ESTADOS_ELEGIBLES}},
    )


async def confirmar_adhesion(
    db: AsyncDatabase,
    *,
    coincidencia_id: str,
    usuario_id: ObjectId,
    secreto: str,
    ahora: datetime | None = None,
) -> AdhesionOut:
    """Registra una sola adhesion por usuario e incidencia, incluso bajo concurrencia."""
    instante = _fecha_utc(ahora or datetime.now(timezone.utc), "ahora")
    coincidencia = await db.coincidencias_duplicados.find_one(
        {
            "_id": coincidencia_id,
            "actor_clave": _clave_actor(usuario_id, secreto),
            "expira_en": {"$gt": instante},
        }
    )
    if coincidencia is None:
        raise CoincidenciaNoEncontrada("Coincidencia no encontrada")
    filtro_huella = {
        "_id": coincidencia["huella_id"],
        "elegible": True,
        "fecha": {"$gte": instante - VENTANA_DUPLICADOS, "$lte": instante},
    }
    huella = await db.huellas_reportes.find_one(
        filtro_huella,
        {"incidencia_id": 1, "codigo": 1, "categoria": 1},
    )
    if huella is None:
        raise CoincidenciaNoElegible("El reporte ya no admite adhesiones")

    adhesion_id = _clave_adhesion(usuario_id, huella["incidencia_id"], secreto)
    registrada = True
    try:
        await db.adhesiones_reportes.insert_one(
            {
                "_id": adhesion_id,
                "incidencia_id": huella["incidencia_id"],
                "codigo": huella["codigo"],
                "categoria": huella["categoria"],
                "fecha": instante,
            }
        )
    except DuplicateKeyError:
        registrada = False

    # El TTL o un cambio de estado pueden ocurrir durante la escritura. Si esta
    # confirmacion fue nueva, se compensa para no adherir a un reporte inelegible.
    if await db.huellas_reportes.count_documents(filtro_huella, limit=1) == 0:
        if registrada:
            await db.adhesiones_reportes.delete_one({"_id": adhesion_id})
        raise CoincidenciaNoElegible("El reporte ya no admite adhesiones")
    total = await db.adhesiones_reportes.count_documents({"incidencia_id": huella["incidencia_id"]})
    return AdhesionOut(
        ok=True,
        codigo=huella["codigo"],
        categoria=huella["categoria"],
        adhesiones=total,
        registrada=registrada,
    )
