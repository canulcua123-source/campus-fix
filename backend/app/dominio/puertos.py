"""Contratos que el dominio expone a la infraestructura."""

from typing import Protocol, runtime_checkable


class StorageNoDisponibleError(RuntimeError):
    """El almacenamiento externo no está configurado o disponible."""


@runtime_checkable
class StoragePort(Protocol):
    """Operaciones de almacenamiento requeridas por incidencias."""

    @property
    def expira_segundos(self) -> int: ...

    def url_subida(self, clave: str, tipo_mime: str, peso_bytes: int) -> str: ...

    def url_lectura(self, clave: str, nombre_archivo: str) -> str: ...

    def promover(self, origen: str, destino: str) -> None: ...

    def tamano_objeto(self, clave: str) -> int | None: ...

    def leer_inicio(self, clave: str, n: int = 32) -> bytes | None:
        """Lee los primeros ``n`` bytes del objeto (Range GET).

        Sirve para inspeccionar los magic bytes antes de promover una evidencia
        de staging/ a su ruta definitiva. Devuelve ``None`` si no existe.
        """
        ...
