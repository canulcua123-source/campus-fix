"""Almacenamiento en memoria, sin red, para pruebas de los consumidores del puerto."""

from app.dominio.puertos import StorageNoDisponibleError


class FakeStorage:
    def __init__(self, *, no_disponible: bool = False) -> None:
        self.no_disponible = no_disponible
        self.llamadas: list[tuple] = []
        self.tamanos: dict[str, int] = {}
        self.contenidos: dict[str, bytes] = {}
        self.promociones: list[tuple[str, str]] = []

    @property
    def expira_segundos(self) -> int:
        return 300

    def _comprobar(self) -> None:
        if self.no_disponible:
            raise StorageNoDisponibleError("Almacenamiento falso no disponible")

    def url_subida(self, clave: str, tipo_mime: str, peso_bytes: int) -> str:
        self._comprobar()
        self.llamadas.append(("url_subida", clave, tipo_mime, peso_bytes))
        return f"https://storage.fake/subir/{clave}"

    def url_lectura(self, clave: str, nombre_archivo: str) -> str:
        self._comprobar()
        self.llamadas.append(("url_lectura", clave, nombre_archivo))
        return f"https://storage.fake/leer/{clave}?archivo={nombre_archivo}"

    def promover(self, origen: str, destino: str) -> None:
        self._comprobar()
        self.llamadas.append(("promover", origen, destino))
        self.promociones.append((origen, destino))
        if origen in self.tamanos:
            self.tamanos[destino] = self.tamanos.pop(origen)
        if origen in self.contenidos:
            self.contenidos[destino] = self.contenidos.pop(origen)

    def tamano_objeto(self, clave: str) -> int | None:
        self._comprobar()
        self.llamadas.append(("tamano_objeto", clave))
        return self.tamanos.get(clave)

    def leer_inicio(self, clave: str, n: int = 32) -> bytes | None:
        self._comprobar()
        self.llamadas.append(("leer_inicio", clave, n))
        if clave not in self.contenidos:
            return None
        return self.contenidos[clave][:n]
