"""Reglas puras para identificadores de categorías y sus campos."""

import re
import unicodedata

CATEGORIAS_SISTEMA = frozenset({"computo_redes", "infraestructura", "academico"})
CAMPOS_RESERVADOS = frozenset({"categoria"})


def _sin_acentos(texto: str) -> str:
    return "".join(
        caracter for caracter in unicodedata.normalize("NFD", texto) if unicodedata.category(caracter) != "Mn"
    )


def _normalizar_identificador(texto: str, *, minimo: int, maximo: int, descripcion: str) -> str:
    if not isinstance(texto, str):
        raise ValueError(f"{descripcion} debe ser texto")
    valor = _sin_acentos(texto.strip().lower())
    valor = re.sub(r"[\s-]+", "_", valor)
    valor = re.sub(r"_+", "_", valor)
    patron = rf"^[a-z][a-z0-9_]{{{minimo - 1},{maximo - 1}}}$"
    if not re.fullmatch(patron, valor):
        raise ValueError(f"{descripcion} no cumple el formato permitido")
    return valor


def normalizar_clave_categoria(texto: str) -> str:
    """Normaliza una clave a snake_case seguro, entre 3 y 30 caracteres."""
    return _normalizar_identificador(texto, minimo=3, maximo=30, descripcion="La clave de categoría")


def normalizar_nombre_campo(texto: str) -> str:
    """Normaliza un nombre de campo y evita colisiones con la estructura de incidencia."""
    nombre = _normalizar_identificador(texto, minimo=1, maximo=50, descripcion="El nombre del campo")
    if nombre in CAMPOS_RESERVADOS:
        raise ValueError("El nombre del campo está reservado")
    return nombre


def es_categoria_sistema(clave: str, sistema: bool = False) -> bool:
    """Protege semillas antiguas por clave y documentos nuevos por su marca explícita."""
    return sistema or clave in CATEGORIAS_SISTEMA
