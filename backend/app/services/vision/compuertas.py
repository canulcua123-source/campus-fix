import unicodedata
from datetime import datetime, timedelta
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.schemas.ia import AccionCompuertas, AnalisisImagen
from app.schemas.incidencia import Ubicacion
from app.services.vision.mapeo import construir_incidencia

UMBRAL_AGENTICO = 0.85
VIGENCIA_UBICACION = timedelta(hours=4)
CATEGORIAS_AGENTICAS = frozenset({"infraestructura"})
PERMISOS_AGENTICOS = frozenset({"ia:usar", "incidencias:crear", "evidencias:subir"})
SEÑALES_CALIDAD = ("borros", "oscur", "instruccion", "falta contexto", "falta_contexto")


class UbicacionCompuertas(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    datos: Ubicacion
    fuente: Literal["qr", "confirmada", "selector", "ia"]
    existe_en_catalogo: bool
    confirmada_en: datetime | None = None

    @field_validator("confirmada_en")
    @classmethod
    def _fecha_con_zona(cls, valor: datetime | None) -> datetime | None:
        if valor is not None and valor.utcoffset() is None:
            raise ValueError("confirmada_en debe incluir zona horaria")
        return valor


class EntradaCompuertas(BaseModel):
    """Estado validado que el servidor entrega al evaluador puro."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    analisis: AnalisisImagen
    ahora: datetime
    calidad_cliente: tuple[str, ...] = ()
    ubicacion: UbicacionCompuertas | None = None
    esquema_valido: bool
    duplicado: Literal["no_encontrado", "probable", "no_verificable"]
    permisos: frozenset[str] = Field(default_factory=frozenset)
    cupo_agentico_disponible: bool
    modo_agentico_habilitado: bool
    categorias_agenticas: frozenset[str] = CATEGORIAS_AGENTICAS

    @field_validator("ahora")
    @classmethod
    def _ahora_con_zona(cls, valor: datetime) -> datetime:
        if valor.utcoffset() is None:
            raise ValueError("ahora debe incluir zona horaria")
        return valor


class ResultadoCompuerta(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: Literal["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9"]
    paso: bool
    motivo: str


class DecisionCompuertas(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    accion: AccionCompuertas
    motivos: tuple[str, ...]
    compuertas: tuple[ResultadoCompuerta, ...]


def _normalizar(texto: str) -> str:
    return "".join(
        caracter for caracter in unicodedata.normalize("NFKD", texto.lower()) if not unicodedata.combining(caracter)
    )


def _ubicacion_valida(entrada: EntradaCompuertas) -> bool:
    ubicacion = entrada.ubicacion
    if ubicacion is None or not ubicacion.existe_en_catalogo:
        return False
    if ubicacion.fuente == "qr":
        return True
    if ubicacion.fuente != "confirmada" or ubicacion.confirmada_en is None:
        return False
    antiguedad = entrada.ahora - ubicacion.confirmada_en
    return timedelta(0) <= antiguedad <= VIGENCIA_UBICACION


def evaluar_compuertas(entrada: EntradaCompuertas) -> DecisionCompuertas:
    """Evalúa G1→G9 de forma pura, determinista y con precedencia explícita.

    G1 valida que haya una incidencia; G2, una categoría habilitada; G3, el
    umbral 0.85; G4, la ausencia de advertencias de calidad; G5, una ubicación
    de catálogo obtenida por QR o confirmada hace como máximo cuatro horas;
    G6 impide prioridad crítica y riesgo alto; G7 consume el resultado de
    validar el mapeo determinista con ``IncidenciaIn``; G8 consume evidencia de
    duplicado; y G9 exige los tres permisos, cupo y kill switch. Cada pase o
    fallo produce el motivo español almacenado en ``ResultadoCompuerta``.

    G8 probable produce ``duplicado`` aun si fallan otras compuertas. Sin G8,
    solo nueve pases producen ``agentico``; cualquier fallo o estado no
    verificable produce ``formulario``. Los motivos conservan el orden G1→G9.
    """
    analisis = entrada.analisis
    calidad = _normalizar(" ".join((*analisis.advertencias, *entrada.calidad_cliente)))
    ubicacion_ok = _ubicacion_valida(entrada)
    # G4 (docs/algoritmo-foto-ia.md): sin señales de calidad del modelo y con el control del cliente vacío.
    calidad_ok = not entrada.calidad_cliente and not any(señal in calidad for señal in SEÑALES_CALIDAD)
    resultados = (
        ResultadoCompuerta(
            id="G1",
            paso=analisis.es_incidencia_valida,
            motivo=(
                "La imagen representa una incidencia del campus."
                if analisis.es_incidencia_valida
                else "No reconocimos una incidencia en la foto; revisa la imagen o llena el formulario."
            ),
        ),
        ResultadoCompuerta(
            id="G2",
            paso=analisis.categoria != "no_determinada" and analisis.categoria in entrada.categorias_agenticas,
            motivo=(
                "La categoría está habilitada para el modo agéntico."
                if analisis.categoria != "no_determinada" and analisis.categoria in entrada.categorias_agenticas
                else "La categoría no está determinada o todavía requiere completar el formulario."
            ),
        ),
        ResultadoCompuerta(
            id="G3",
            paso=analisis.confianza >= UMBRAL_AGENTICO,
            motivo=(
                "La confianza del análisis es suficiente para continuar."
                if analisis.confianza >= UMBRAL_AGENTICO
                else "La confianza del análisis no es suficiente; revisa los datos en el formulario."
            ),
        ),
        ResultadoCompuerta(
            id="G4",
            paso=calidad_ok,
            motivo=(
                "La imagen no presenta advertencias de calidad."
                if calidad_ok
                else "La foto podría no ser clara o contener instrucciones; revisa el formulario."
            ),
        ),
        ResultadoCompuerta(
            id="G5",
            paso=ubicacion_ok,
            motivo=(
                "La ubicación fue verificada por el servidor."
                if ubicacion_ok
                else "Confirma una ubicación válida mediante el QR del aula o una confirmación reciente."
            ),
        ),
        ResultadoCompuerta(
            id="G6",
            paso=analisis.prioridad_sugerida != "critica"
            and (analisis.detalle_infra is None or analisis.detalle_infra.riesgo_seguridad != "alto"),
            motivo=(
                "El análisis no intenta tomar una decisión reservada."
                if analisis.prioridad_sugerida != "critica"
                and (analisis.detalle_infra is None or analisis.detalle_infra.riesgo_seguridad != "alto")
                else "Confirma en el formulario la prioridad crítica o el riesgo para las personas."
            ),
        ),
        ResultadoCompuerta(
            id="G7",
            paso=entrada.esquema_valido,
            motivo=(
                "Los datos se pueden convertir en una incidencia válida."
                if entrada.esquema_valido
                else "Faltan datos válidos para crear la incidencia; complétalos en el formulario."
            ),
        ),
        ResultadoCompuerta(
            id="G8",
            paso=entrada.duplicado == "no_encontrado",
            motivo=(
                "No se encontró un reporte duplicado."
                if entrada.duplicado == "no_encontrado"
                else (
                    "Encontramos un reporte que podría corresponder a la misma incidencia."
                    if entrada.duplicado == "probable"
                    else "No se pudo verificar de forma segura si ya existe un reporte igual."
                )
            ),
        ),
        ResultadoCompuerta(
            id="G9",
            paso=PERMISOS_AGENTICOS <= entrada.permisos
            and entrada.cupo_agentico_disponible
            and entrada.modo_agentico_habilitado,
            motivo=(
                "Los permisos, el cupo y el modo agéntico están habilitados."
                if PERMISOS_AGENTICOS <= entrada.permisos
                and entrada.cupo_agentico_disponible
                and entrada.modo_agentico_habilitado
                else "El modo agéntico no está disponible con los permisos o cupos actuales."
            ),
        ),
    )
    fallos = tuple(resultado.motivo for resultado in resultados if not resultado.paso)
    if entrada.duplicado == "probable":
        accion: AccionCompuertas = "duplicado"
    elif all(resultado.paso for resultado in resultados):
        accion = "agentico"
    else:
        accion = "formulario"
    return DecisionCompuertas(accion=accion, motivos=fallos, compuertas=resultados)


def mapeo_valido(analisis: AnalisisImagen, ubicacion: UbicacionCompuertas | None) -> bool:
    """G7: el análisis se puede convertir en un IncidenciaIn válido con el mapeo determinista de T-032."""
    if ubicacion is None:
        return False
    try:
        construir_incidencia(analisis, ubicacion.datos)
    except (ValueError, ValidationError):
        return False
    return True
