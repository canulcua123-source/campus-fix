from typing import Literal, get_args

from pydantic import BaseModel, Field, field_validator

CATALOGO_PERMISOS = [
    "incidencias:crear",
    "incidencias:ver",
    "incidencias:asignar",
    "incidencias:buscar",
    "evidencias:subir",
    "seguimiento:registrar",
    "tags:gestionar",
    "analitica:ver",
    "usuarios:gestionar",
    "roles:gestionar",
    "categorias:gestionar",
    "ia:usar",
    "configuracion:gestionar",
]

Permiso = Literal[
    "incidencias:crear",
    "incidencias:ver",
    "incidencias:asignar",
    "incidencias:buscar",
    "evidencias:subir",
    "seguimiento:registrar",
    "tags:gestionar",
    "analitica:ver",
    "usuarios:gestionar",
    "roles:gestionar",
    "categorias:gestionar",
    "ia:usar",
    "configuracion:gestionar",
]
assert list(get_args(Permiso)) == CATALOGO_PERMISOS


class RolIn(BaseModel):
    clave: str = Field(pattern=r"^[a-z_]{3,30}$")
    nombre: str = Field(min_length=3, max_length=50)
    descripcion: str = Field(default="", max_length=200)
    permisos: list[Permiso] = Field(min_length=1)
    alcance: Literal["propio", "area", "edificio", "global"]

    @field_validator("permisos")
    @classmethod
    def _unicos(cls, v: list[str]) -> list[str]:
        if len(set(v)) != len(v):
            raise ValueError("permisos duplicados")
        return v
