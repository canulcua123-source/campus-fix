"""Construccion y validacion de detalles para categorias personalizadas."""

import math
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    IPvAnyAddress,
    StrictBool,
    StrictFloat,
    StrictInt,
    StrictStr,
    create_model,
)

from app.dominio.categorias import normalizar_clave_categoria, normalizar_nombre_campo

TIPOS_DINAMICOS = frozenset({"texto", "numero", "entero", "booleano", "ip", "lista"})


class DefinicionDetalleError(ValueError):
    """Indica que una definicion persistida no es segura para compilar."""


def _limites(campo: dict[str, Any], *, enteros: bool = False) -> tuple[int | float | None, int | float | None]:
    minimo = campo.get("min")
    maximo = campo.get("max")
    for limite in (minimo, maximo):
        if limite is None:
            continue
        if isinstance(limite, bool) or not isinstance(limite, int | float) or not math.isfinite(limite):
            raise DefinicionDetalleError("Los limites del campo deben ser numeros finitos")
        if enteros and type(limite) is not int:
            raise DefinicionDetalleError("Los limites del campo deben ser enteros")
    if minimo is not None and maximo is not None and minimo > maximo:
        raise DefinicionDetalleError("El limite minimo no puede superar al maximo")
    return minimo, maximo


def _tipo_campo(campo: dict[str, Any]) -> Any:
    tipo = campo.get("tipo")
    if tipo not in TIPOS_DINAMICOS:
        raise DefinicionDetalleError("La definicion contiene un tipo de campo no permitido")
    if tipo != "lista" and campo.get("opciones") is not None:
        raise DefinicionDetalleError("Solo un campo de lista admite opciones")

    if tipo == "texto":
        minimo, maximo = _limites(campo, enteros=True)
        if (minimo is not None and minimo < 0) or (maximo is not None and maximo < 0):
            raise DefinicionDetalleError("Las longitudes de texto no pueden ser negativas")
        return Annotated[StrictStr, Field(min_length=minimo, max_length=maximo)]

    if tipo == "numero":
        minimo, maximo = _limites(campo)
        numero = StrictInt | Annotated[StrictFloat, Field(allow_inf_nan=False)]
        return Annotated[numero, Field(ge=minimo, le=maximo)]

    if tipo == "entero":
        minimo, maximo = _limites(campo, enteros=True)
        return Annotated[StrictInt, Field(ge=minimo, le=maximo)]

    if tipo == "booleano":
        if campo.get("min") is not None or campo.get("max") is not None:
            raise DefinicionDetalleError("Un campo booleano no admite limites")
        return StrictBool

    if tipo == "ip":
        if campo.get("min") is not None or campo.get("max") is not None:
            raise DefinicionDetalleError("Un campo IP no admite limites")
        return IPvAnyAddress

    if campo.get("min") is not None or campo.get("max") is not None:
        raise DefinicionDetalleError("Un campo de lista no admite limites")
    opciones = campo.get("opciones")
    if not isinstance(opciones, list) or not 1 <= len(opciones) <= 50:
        raise DefinicionDetalleError("Un campo de lista requiere entre 1 y 50 opciones")
    if any(not isinstance(opcion, str) or not 1 <= len(opcion) <= 80 for opcion in opciones):
        raise DefinicionDetalleError("Las opciones deben ser textos acotados")
    if len(opciones) != len(set(opciones)):
        raise DefinicionDetalleError("Las opciones no pueden repetirse")
    return Literal.__getitem__(tuple(opciones))


def construir_modelo_detalle(definicion: dict[str, Any]) -> type[BaseModel]:
    """Compila una definicion validada mediante ``pydantic.create_model``."""
    if not isinstance(definicion, dict):
        raise DefinicionDetalleError("La definicion de categoria debe ser un objeto")
    try:
        clave = normalizar_clave_categoria(definicion.get("clave"))
    except ValueError as exc:
        raise DefinicionDetalleError("La clave de categoria no es segura") from exc
    if clave != definicion.get("clave"):
        raise DefinicionDetalleError("La clave de categoria debe estar normalizada")

    version = definicion.get("version")
    if type(version) is not int or version < 1:
        raise DefinicionDetalleError("La version de categoria debe ser un entero positivo")
    campos = definicion.get("campos")
    if not isinstance(campos, list) or not 1 <= len(campos) <= 30:
        raise DefinicionDetalleError("La categoria debe definir entre 1 y 30 campos")

    definiciones: dict[str, tuple[Any, Any]] = {
        "categoria": (Literal[clave], Field(description="Discriminador de la categoria")),
    }
    nombres: set[str] = set()
    for campo in campos:
        if not isinstance(campo, dict):
            raise DefinicionDetalleError("Cada campo de categoria debe ser un objeto")
        try:
            nombre = normalizar_nombre_campo(campo.get("nombre"))
        except ValueError as exc:
            raise DefinicionDetalleError("La definicion contiene un nombre de campo inseguro") from exc
        if nombre != campo.get("nombre"):
            raise DefinicionDetalleError("Los nombres de campo deben estar normalizados")
        if nombre in nombres:
            raise DefinicionDetalleError("Los nombres de campo no pueden repetirse")
        nombres.add(nombre)
        requerido = campo.get("requerido")
        if type(requerido) is not bool:
            raise DefinicionDetalleError("La propiedad requerido debe ser booleana")
        anotacion = _tipo_campo(campo)
        definiciones[nombre] = (anotacion, ... if requerido else None)

    nombre_modelo = "Detalle" + "".join(parte.capitalize() for parte in clave.split("_")) + f"V{version}"
    return create_model(
        nombre_modelo,
        __config__=ConfigDict(extra="forbid", strict=True),
        __module__=__name__,
        **definiciones,
    )


def validar_detalle_dinamico(definicion: dict[str, Any], detalle: dict[str, Any]) -> dict[str, Any]:
    """Valida y serializa un detalle sin rellenar opcionales ausentes con null."""
    modelo = construir_modelo_detalle(definicion)
    validado = modelo.model_validate(detalle)
    return validado.model_dump(mode="json", exclude_unset=True, exclude_none=True)
