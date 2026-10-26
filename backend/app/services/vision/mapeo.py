from app.schemas.ia import AnalisisImagen
from app.schemas.infraestructura import RiesgoSeguridad, TipoDano
from app.schemas.incidencia import IncidenciaIn, Prioridad, Ubicacion, normalizar_tag

# Tablas exhaustivas: ningún valor depende del orden de los enums.
RIESGO_SEGURO: dict[RiesgoSeguridad, RiesgoSeguridad] = {
    RiesgoSeguridad.BAJO: RiesgoSeguridad.BAJO,
    RiesgoSeguridad.MEDIO: RiesgoSeguridad.MEDIO,
    RiesgoSeguridad.ALTO: RiesgoSeguridad.MEDIO,
}
PRIORIDAD_SEGURA: dict[str, Prioridad] = {
    "baja": "baja",
    "media": "media",
    "alta": "alta",
    "critica": "alta",
}
TEXTO_POR_DANO: dict[TipoDano, tuple[str, str]] = {
    TipoDano.FILTRACION: ("Filtración detectada", "Se detectó una filtración en la infraestructura."),
    TipoDano.ELECTRICO: ("Daño eléctrico detectado", "Se detectó un daño eléctrico en la infraestructura."),
    TipoDano.CLIMATIZACION: ("Falla de climatización", "Se detectó una falla de climatización en la infraestructura."),
    TipoDano.CERRAJERIA: ("Daño de cerrajería", "Se detectó un daño de cerrajería en la infraestructura."),
    TipoDano.LUMINARIA: ("Falla de luminaria", "Se detectó una falla de luminaria en la infraestructura."),
    TipoDano.OTRO: ("Daño de infraestructura", "Se detectó un daño en la infraestructura del campus."),
}


def _texto_acotado(texto: str, respaldo: str, minimo: int, maximo: int) -> str:
    limpio = " ".join(texto.split())
    return limpio[:maximo] if len(limpio) >= minimo else respaldo


def _tags_seguras(tags: list[str], tipo_dano: TipoDano) -> list[str]:
    salida = ["infraestructura", tipo_dano.value]
    for tag in tags[:30]:
        try:
            normalizado = normalizar_tag(tag)
        except ValueError:
            continue
        if normalizado not in salida:
            salida.append(normalizado)
        if len(salida) == 15:
            break
    return salida


def construir_incidencia(a: AnalisisImagen, ubic: Ubicacion) -> IncidenciaIn:
    """Mapea un análisis de infraestructura sin efectos ni decisiones reservadas."""
    if a.categoria != "infraestructura" or a.detalle_infra is None:
        raise ValueError("solo se pueden mapear análisis de infraestructura")

    tipo_dano = a.detalle_infra.tipo_dano
    titulo_respaldo, descripcion_respaldo = TEXTO_POR_DANO[tipo_dano]
    return IncidenciaIn(
        titulo=_texto_acotado(a.titulo, titulo_respaldo, 5, 120),
        descripcion=_texto_acotado(a.descripcion, descripcion_respaldo, 10, 2000),
        prioridad=PRIORIDAD_SEGURA[a.prioridad_sugerida],
        ubicacion=Ubicacion.model_validate(ubic.model_dump()),
        detalle_especifico={
            "categoria": "infraestructura",
            "tipo_dano": tipo_dano,
            "riesgo_seguridad": RIESGO_SEGURO[a.detalle_infra.riesgo_seguridad],
            "requiere_insumos": False,
            "requiere_contratista": False,
        },
        tags=_tags_seguras(a.tags, tipo_dano),
    )
