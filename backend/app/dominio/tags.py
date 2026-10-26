"""Normalización de etiquetas de incidencias."""

import re
import unicodedata
from collections.abc import Iterable

_RE_TAG = re.compile(r"^[a-z0-9_]{2,30}$")


def normalizar_tag(texto: str) -> str:
    """Normaliza una etiqueta y valida el contrato ``^[a-z0-9_]{2,30}$``."""
    sin_acentos = "".join(
        caracter
        for caracter in unicodedata.normalize("NFD", texto.strip().lower())
        if unicodedata.category(caracter) != "Mn"
    )
    tag = re.sub(r"\s+", "_", sin_acentos)
    if not _RE_TAG.fullmatch(tag):
        raise ValueError(f"Tag inválido: {texto!r}")
    return tag


def normalizar_tags(tags: Iterable[str]) -> list[str]:
    """Normaliza, elimina duplicados y ordena una colección de etiquetas."""
    return sorted({normalizar_tag(tag) for tag in tags})
