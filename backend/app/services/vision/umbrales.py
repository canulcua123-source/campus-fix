"""Única fuente de verdad de los umbrales de confianza y de las advertencias que la topan.

``decidir`` (T-030) y las compuertas G3/G4 importan estos valores; nunca se duplican.
"""

import unicodedata
from collections.abc import Iterable

from app.schemas.ia import AnalisisImagen

UMBRAL_PREGUNTAR = 0.5
UMBRAL_AUTOLLENAR = 0.8
UMBRAL_AGENTICO = 0.85
# Con advertencias de calidad la confianza efectiva queda por debajo de autollenar (y del umbral agéntico).
TOPE_CONFIANZA_DUDOSA = 0.79

if not UMBRAL_PREGUNTAR < UMBRAL_AUTOLLENAR <= UMBRAL_AGENTICO:
    raise RuntimeError("Umbrales de IA incoherentes: el agéntico nunca puede ser menor que autollenar")
if not TOPE_CONFIANZA_DUDOSA < UMBRAL_AUTOLLENAR:
    raise RuntimeError("El tope por advertencias debe quedar por debajo del umbral de autollenar")

# Advertencias (del modelo o pistas del cliente) que topan la confianza y hacen fallar G4.
ADVERTENCIAS_DUDOSAS = frozenset({"borrosa", "oscura", "sobreexpuesta", "falta_contexto", "texto_con_instrucciones"})


def normalizar_señal(texto: str) -> str:
    """Minúsculas, sin espacios externos ni acentos: ``" Oscúra "`` → ``"oscura"``."""
    return "".join(
        caracter
        for caracter in unicodedata.normalize("NFKD", texto.strip().lower())
        if not unicodedata.combining(caracter)
    )


def hay_señal_dudosa(advertencias: Iterable[str], calidad: Iterable[str] = ()) -> bool:
    return any(normalizar_señal(señal) in ADVERTENCIAS_DUDOSAS for señal in (*advertencias, *calidad))


def confianza_efectiva(analisis: AnalisisImagen, calidad: Iterable[str] = ()) -> AnalisisImagen:
    """Copia del análisis con la confianza topada si hay señales dudosas; el original no cambia."""
    if hay_señal_dudosa(analisis.advertencias, calidad) and analisis.confianza > TOPE_CONFIANZA_DUDOSA:
        return analisis.model_copy(update={"confianza": TOPE_CONFIANZA_DUDOSA})
    return analisis
