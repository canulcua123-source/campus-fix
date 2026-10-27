import unicodedata
from collections.abc import Sequence

from app.schemas.ia import AnalisisImagen, DecisionAsistida

# Una sola lista para las reglas de confianza y las compuertas (también recibe las pistas del cliente).
ADVERTENCIAS_DUDOSAS = ("borros", "oscur", "sobreexpu", "instruccion", "falta contexto", "falta_contexto")


def _normalizar(texto: str) -> str:
    return "".join(
        caracter for caracter in unicodedata.normalize("NFKD", texto.lower()) if not unicodedata.combining(caracter)
    )


def decidir(
    analisis: AnalisisImagen,
    calidad: str | Sequence[str] | None = None,
    *,
    cache: bool = False,
) -> DecisionAsistida:
    """Convierte un análisis validado en una acción determinista para la interfaz."""
    if not analisis.es_incidencia_valida:
        return DecisionAsistida(
            accion="rechazar",
            mensaje="No reconocimos una incidencia en la foto. Toma otra foto del problema o llena el formulario.",
            analisis=analisis,
            cache=cache,
        )

    partes_calidad = [calidad] if isinstance(calidad, str) else list(calidad or ())
    señales = _normalizar(" ".join([*analisis.advertencias, *partes_calidad]))
    confianza = analisis.confianza
    if any(fragmento in señales for fragmento in ADVERTENCIAS_DUDOSAS):
        confianza = min(confianza, 0.79)
        # La UI muestra la confianza efectiva (topada), no la que reportó el modelo.
        analisis = analisis.model_copy(update={"confianza": confianza})

    if analisis.categoria == "no_determinada" or confianza < 0.5:
        return DecisionAsistida(
            accion="preguntar",
            mensaje="No pudimos determinar el tipo de problema. Selecciona una categoría para continuar.",
            analisis=analisis,
            cache=cache,
        )
    if confianza < 0.8 or analisis.prioridad_sugerida == "critica":
        return DecisionAsistida(
            accion="sugerir",
            mensaje="La IA encontró una posible incidencia. Revisa la categoría y los datos antes de enviar.",
            analisis=analisis,
            cache=cache,
        )
    return DecisionAsistida(
        accion="autollenar",
        mensaje="Completamos el formulario con la sugerencia de la IA. Revísalo antes de enviarlo.",
        analisis=analisis,
        cache=cache,
    )
