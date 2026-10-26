"""Composición y fachada compatible del almacenamiento de evidencias."""

from collections.abc import Callable
from functools import lru_cache
from typing import Any

from fastapi import HTTPException

from app.adaptadores.storage_b2 import B2Storage, EXPIRA_SEGUNDOS
from app.core.config import settings
from app.dominio.puertos import StorageNoDisponibleError, StoragePort


@lru_cache
def _adaptador() -> B2Storage:
    endpoint = settings.storage_endpoint or (
        f"https://{settings.r2_account_id}.r2.cloudflarestorage.com" if settings.r2_account_id else ""
    )
    return B2Storage(
        endpoint=endpoint,
        access_key_id=settings.r2_access_key_id,
        secret_access_key=settings.r2_secret_access_key,
        bucket=settings.r2_bucket,
        region=settings.storage_region,
    )


def _cliente():
    """Compatibilidad para scripts existentes; no crea el cliente hasta invocarse."""
    try:
        return _adaptador().requerir_cliente()
    except StorageNoDisponibleError:
        return None


def _requerir_cliente():
    """Compatibilidad con ``scripts/limpiar_huerfanos.py``."""
    cliente = _cliente()
    if cliente is None:
        raise HTTPException(503, "El almacenamiento de evidencias no está configurado")
    return cliente


def _traducir_no_disponible(operacion: Callable[[], Any]) -> Any:
    try:
        return operacion()
    except StorageNoDisponibleError as exc:
        raise HTTPException(503, str(exc)) from exc


def url_subida(clave: str, tipo_mime: str, peso_bytes: int) -> str:
    return _traducir_no_disponible(lambda: _adaptador().url_subida(clave, tipo_mime, peso_bytes))


def url_lectura(clave: str, nombre_archivo: str) -> str:
    return _traducir_no_disponible(lambda: _adaptador().url_lectura(clave, nombre_archivo))


def promover(origen: str, destino: str) -> None:
    _traducir_no_disponible(lambda: _adaptador().promover(origen, destino))


def tamano_objeto(clave: str) -> int | None:
    return _traducir_no_disponible(lambda: _adaptador().tamano_objeto(clave))


class _StorageCompatibilidad:
    """Puerto que conserva los puntos de monkeypatch de las pruebas existentes."""

    @property
    def expira_segundos(self) -> int:
        return EXPIRA_SEGUNDOS

    def url_subida(self, clave: str, tipo_mime: str, peso_bytes: int) -> str:
        return url_subida(clave, tipo_mime, peso_bytes)

    def url_lectura(self, clave: str, nombre_archivo: str) -> str:
        return url_lectura(clave, nombre_archivo)

    def promover(self, origen: str, destino: str) -> None:
        promover(origen, destino)

    def tamano_objeto(self, clave: str) -> int | None:
        return tamano_objeto(clave)


_STORAGE: StoragePort = _StorageCompatibilidad()


def get_storage() -> StoragePort:
    """Dependencia de FastAPI para sustituir el almacenamiento en pruebas."""
    return _STORAGE
