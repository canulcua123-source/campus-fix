from collections.abc import Sequence

from app.schemas.ia import AnalisisImagen, DecisionAsistida
from app.services.vision.umbrales import UMBRAL_AUTOLLENAR, UMBRAL_PREGUNTAR, confianza_efectiva


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
    # La UI y las compuertas ven la confianza efectiva (topada), no la que reportó el modelo.
    analisis = confianza_efectiva(analisis, partes_calidad)
    confianza = analisis.confianza

    if analisis.categoria == "no_determinada" or confianza < UMBRAL_PREGUNTAR:
        return DecisionAsistida(
            accion="preguntar",
            mensaje="No pudimos determinar el tipo de problema. Selecciona una categoría para continuar.",
            analisis=analisis,
            cache=cache,
        )
    if confianza < UMBRAL_AUTOLLENAR or analisis.prioridad_sugerida == "critica":
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
