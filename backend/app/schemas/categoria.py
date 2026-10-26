"""Contratos Pydantic para el catálogo administrable de categorías."""

import math
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator, model_validator

from app.dominio.categorias import normalizar_clave_categoria, normalizar_nombre_campo

TipoCampoNuevo = Literal["texto", "numero", "entero", "booleano", "ip", "lista"]
TipoCampoCatalogo = Literal["texto", "numero", "entero", "booleano", "ip", "lista", "enum", "lista_texto"]
Opcion = Annotated[str, Field(min_length=1, max_length=80)]


class CampoCategoria(BaseModel):
    """Definición permitida para un campo de una categoría personalizada."""

    model_config = ConfigDict(extra="forbid")

    nombre: str
    etiqueta: str = Field(min_length=1, max_length=80)
    tipo: TipoCampoNuevo
    requerido: StrictBool
    opciones: list[Opcion] | None = Field(default=None, min_length=1, max_length=50)
    min: int | float | None = None
    max: int | float | None = None

    @field_validator("nombre", mode="before")
    @classmethod
    def _nombre_seguro(cls, valor: Any) -> str:
        return normalizar_nombre_campo(valor)

    @field_validator("etiqueta", mode="before")
    @classmethod
    def _etiqueta_limpia(cls, valor: Any) -> Any:
        return valor.strip() if isinstance(valor, str) else valor

    @field_validator("opciones", mode="before")
    @classmethod
    def _opciones_limpias(cls, valor: Any) -> Any:
        if valor is None or not isinstance(valor, list):
            return valor
        opciones = [opcion.strip() if isinstance(opcion, str) else opcion for opcion in valor]
        if all(isinstance(opcion, str) for opcion in opciones) and len(opciones) != len(set(opciones)):
            raise ValueError("Las opciones no pueden repetirse")
        return opciones

    @field_validator("min", "max", mode="before")
    @classmethod
    def _limite_numerico(cls, valor: Any) -> Any:
        if valor is None:
            return valor
        if isinstance(valor, bool) or not isinstance(valor, int | float) or not math.isfinite(valor):
            raise ValueError("Los límites deben ser números finitos")
        return valor

    @model_validator(mode="after")
    def _configuracion_por_tipo(self):
        tiene_opciones = self.opciones is not None
        tiene_limites = self.min is not None or self.max is not None

        if self.tipo == "lista":
            if not tiene_opciones:
                raise ValueError("Los campos de tipo lista requieren opciones")
            if tiene_limites:
                raise ValueError("Los campos de tipo lista no admiten límites")
        elif tiene_opciones:
            raise ValueError("Solo los campos de tipo lista admiten opciones")

        if self.tipo in {"booleano", "ip"} and tiene_limites:
            raise ValueError(f"Los campos de tipo {self.tipo} no admiten límites")
        if self.tipo == "texto":
            for limite in (self.min, self.max):
                if limite is not None and (type(limite) is not int or limite < 0):
                    raise ValueError("Los límites de texto deben ser enteros no negativos")
        if self.tipo == "entero":
            for limite in (self.min, self.max):
                if limite is not None and type(limite) is not int:
                    raise ValueError("Los límites de un entero deben ser enteros")
        if self.min is not None and self.max is not None and self.min > self.max:
            raise ValueError("El límite mínimo no puede ser mayor que el máximo")
        return self


class CategoriaIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    clave: str
    nombre: str = Field(min_length=3, max_length=80)
    prefijo: str = Field(pattern=r"^[A-Z]{3}$")
    area_responsable: str = Field(min_length=3, max_length=100)
    campos: list[CampoCategoria] = Field(min_length=1, max_length=30)

    @field_validator("clave", mode="before")
    @classmethod
    def _clave_normalizada(cls, valor: Any) -> str:
        return normalizar_clave_categoria(valor)

    @field_validator("nombre", "area_responsable", mode="before")
    @classmethod
    def _texto_limpio(cls, valor: Any) -> Any:
        return valor.strip() if isinstance(valor, str) else valor

    @field_validator("prefijo", mode="before")
    @classmethod
    def _prefijo_limpio(cls, valor: Any) -> Any:
        return valor.strip() if isinstance(valor, str) else valor

    @field_validator("campos")
    @classmethod
    def _campos_unicos(cls, campos: list[CampoCategoria]) -> list[CampoCategoria]:
        nombres = [campo.nombre for campo in campos]
        if len(nombres) != len(set(nombres)):
            raise ValueError("Los nombres de campos no pueden repetirse")
        return campos


class CategoriaPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nombre: str | None = Field(default=None, min_length=3, max_length=80)
    prefijo: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    area_responsable: str | None = Field(default=None, min_length=3, max_length=100)
    activa: StrictBool | None = None
    campos: list[CampoCategoria] | None = Field(default=None, min_length=1, max_length=30)

    @model_validator(mode="before")
    @classmethod
    def _sin_nulos_explicitos(cls, datos: Any) -> Any:
        if isinstance(datos, dict) and any(valor is None for valor in datos.values()):
            raise ValueError("Los campos enviados no pueden ser null")
        return datos

    @field_validator("nombre", "area_responsable", mode="before")
    @classmethod
    def _texto_limpio(cls, valor: Any) -> Any:
        return valor.strip() if isinstance(valor, str) else valor

    @field_validator("prefijo", mode="before")
    @classmethod
    def _prefijo_limpio(cls, valor: Any) -> Any:
        return valor.strip() if isinstance(valor, str) else valor

    @field_validator("campos")
    @classmethod
    def _campos_unicos(cls, campos: list[CampoCategoria] | None) -> list[CampoCategoria] | None:
        if campos is None:
            return campos
        nombres = [campo.nombre for campo in campos]
        if len(nombres) != len(set(nombres)):
            raise ValueError("Los nombres de campos no pueden repetirse")
        return campos

    @model_validator(mode="after")
    def _con_cambios(self):
        if not self.model_fields_set:
            raise ValueError("Debe enviarse al menos un cambio")
        return self


class CampoCategoriaOut(BaseModel):
    """Forma de salida compatible con campos nuevos y tipos históricos del sistema."""

    model_config = ConfigDict(extra="forbid")

    nombre: str
    etiqueta: str | None = None
    tipo: TipoCampoCatalogo
    requerido: bool
    opciones: list[str] | None = None
    min: int | float | None = None
    max: int | float | None = None
    max_length: int | None = None
    patron: str | None = None


class CategoriaOut(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str = Field(alias="_id")
    clave: str
    nombre: str
    prefijo: str
    area_responsable: str
    version: int
    activa: bool
    campos: list[CampoCategoriaOut]
    sistema: bool | None = None
    fecha_creacion: datetime | None = None
    fecha_actualizacion: datetime | None = None
