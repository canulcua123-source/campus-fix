import asyncio
from datetime import datetime, timezone
from typing import Annotated, Any, Literal

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from pymongo.errors import DuplicateKeyError

from app.core.auditoria import registrar_auditoria
from app.core.db import get_db
from app.core.config import PATRON_CORREO, validar_dominio_correo
from app.core.security import hashear_password, puede_otorgar, require_permiso
from app.core.serial import a_json

router = APIRouter(prefix="/usuarios", tags=["usuarios"])

Categoria = Literal["computo_redes", "infraestructura", "academico"]
Edificio = Annotated[str, Field(min_length=1, max_length=60)]
TipoReportante = Literal["docente", "estudiante", "administrativo"]
PROYECCION = {"password_hash": 0}


class UsuarioPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nombre: str | None = Field(default=None, min_length=3, max_length=80)
    rol: str | None = Field(default=None, pattern=r"^[a-z_]{3,30}$")
    areas: list[Categoria] | None = Field(default=None, max_length=3)
    edificios: list[Edificio] | None = Field(default=None, max_length=20)
    tipo_reportante: TipoReportante | None = None
    activo: bool | None = None


class UsuarioIn(UsuarioPatch):
    nombre: str = Field(min_length=3, max_length=80)
    correo: str = Field(min_length=3, max_length=254, pattern=PATRON_CORREO)
    password: str = Field(min_length=10, max_length=128)
    rol: str = Field(pattern=r"^[a-z_]{3,30}$")

    @field_validator("correo", mode="before")
    @classmethod
    def _minusculas(cls, v):
        return v.strip().lower() if isinstance(v, str) else v

    @field_validator("correo")
    @classmethod
    def _dominio_institucional(cls, v: str) -> str:
        return validar_dominio_correo(v)


async def _validar_asignacion(rol: str, areas: list | None, edificios: list | None, creador: dict) -> dict[str, Any]:
    """Valida el rol y devuelve los campos de alcance a guardar (solo los que aplican al alcance del rol)."""
    doc_rol = await get_db().roles.find_one({"clave": rol})
    if doc_rol is None:
        raise HTTPException(400, "El rol indicado no existe")
    alcance = doc_rol.get("alcance", "propio")
    campos: dict[str, Any] = {}
    if alcance == "area":
        if not areas:
            raise HTTPException(400, "Un rol con alcance 'area' requiere al menos un área")
        campos = {"areas": sorted(set(areas))}
    elif alcance == "edificio":
        if not edificios:
            raise HTTPException(400, "Un rol con alcance 'edificio' requiere al menos un edificio")
        campos = {"edificios": sorted(set(edificios))}
    # Sin escalar privilegios: ni permisos, ni alcance, ni áreas/edificios por encima de los del creador.
    if not puede_otorgar(creador, doc_rol.get("permisos", []), alcance, campos.get("areas"), campos.get("edificios")):
        raise HTTPException(403, "No puedes asignar un rol o alcance mayor al tuyo")
    return campos


async def _filtro_usuarios_gestionables(actor: dict) -> dict[str, Any]:
    """Limita desde MongoDB el directorio visible y editable por el actor."""
    permisos_actor = set(actor["_permisos"])
    alcance_actor = actor["_alcance"]
    roles_permitidos: list[str] = []
    roles_prohibidos: list[str] = []
    cursor = get_db().roles.find({}, {"clave": 1, "permisos": 1, "alcance": 1})
    async for rol in cursor:
        permisos_objetivo = set(rol.get("permisos", []))
        if not permisos_objetivo <= permisos_actor:
            roles_prohibidos.append(rol["clave"])
            continue
        if alcance_actor != "global" and (
            rol.get("alcance", "propio") != alcance_actor or permisos_objetivo >= permisos_actor
        ):
            continue
        roles_permitidos.append(rol["clave"])

    if alcance_actor == "global":
        # Un usuario con rol inexistente no tiene permisos: el gestor global puede verlo y corregirlo.
        return {"rol": {"$nin": roles_prohibidos}}

    gestionables: dict[str, Any] = {"rol": {"$in": roles_permitidos}}

    campo = "areas" if alcance_actor == "area" else "edificios"
    gestionables["$expr"] = {
        "$setIsSubset": [
            {"$ifNull": [f"${campo}", []]},
            {"$literal": list(actor.get(campo, []))},
        ]
    }
    # El propio perfil se muestra para permitir editar el nombre, pero las
    # reglas de autoedición siguen bloqueando rol, alcance y desactivación.
    return {"$or": [{"_id": actor["_id"]}, gestionables]}


async def _filtro_usuario_gestionable(actor: dict, objetivo_id: ObjectId) -> dict[str, Any]:
    return {"$and": [{"_id": objetivo_id}, await _filtro_usuarios_gestionables(actor)]}


@router.get("")
async def listar(usuario: Annotated[dict, Depends(require_permiso("usuarios:gestionar"))]):
    filtro = await _filtro_usuarios_gestionables(usuario)
    return [a_json(u) async for u in get_db().usuarios.find(filtro, PROYECCION).sort("nombre", 1)]


@router.post("", status_code=201)
async def crear(datos: UsuarioIn, usuario: Annotated[dict, Depends(require_permiso("usuarios:gestionar"))]):
    alcance = await _validar_asignacion(datos.rol, datos.areas, datos.edificios, usuario)
    doc: dict[str, Any] = {
        "schema_version": 1,
        "nombre": datos.nombre,
        "correo": datos.correo,
        "password_hash": await asyncio.to_thread(hashear_password, datos.password),
        "rol": datos.rol,
        **alcance,
        "activo": True if datos.activo is None else datos.activo,
        "fecha_alta": datetime.now(timezone.utc),
    }
    if datos.tipo_reportante:
        doc["tipo_reportante"] = datos.tipo_reportante
    try:
        res = await get_db().usuarios.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(409, "Ya existe un usuario con ese correo")
    doc["_id"] = res.inserted_id
    await registrar_auditoria(
        actor=usuario,
        accion="crear",
        recurso="usuarios",
        recurso_id=str(res.inserted_id),
        despues=doc,
    )
    return a_json(doc)


@router.patch("/{usuario_id}")
async def editar(
    usuario_id: str, datos: UsuarioPatch, usuario: Annotated[dict, Depends(require_permiso("usuarios:gestionar"))]
):
    if not ObjectId.is_valid(usuario_id):
        raise HTTPException(400, "Identificador inválido")
    oid = ObjectId(usuario_id)
    filtro_gestionable = await _filtro_usuario_gestionable(usuario, oid)
    actual = await get_db().usuarios.find_one(filtro_gestionable)
    if actual is None:
        raise HTTPException(404, "Usuario no encontrado")
    cambios = datos.model_dump(exclude_unset=True, exclude_none=True)
    if oid == usuario["_id"] and ({"rol", "areas", "edificios"} & cambios.keys() or cambios.get("activo") is False):
        raise HTTPException(400, "No puedes cambiar tu propio rol, alcance ni desactivarte")
    sets: dict[str, Any] = {k: v for k, v in cambios.items() if k in ("nombre", "tipo_reportante", "activo")}
    unsets: dict[str, str] = {}
    if {"rol", "areas", "edificios"} & cambios.keys():
        rol = cambios.get("rol", actual["rol"])
        alcance = await _validar_asignacion(
            rol, cambios.get("areas", actual.get("areas")), cambios.get("edificios", actual.get("edificios")), usuario
        )
        sets.update({"rol": rol, **alcance})
        unsets = {k: "" for k in ("areas", "edificios") if k not in alcance}
    if not sets and not unsets:
        raise HTTPException(400, "No hay cambios")
    update: dict[str, Any] = {"$set": sets}
    if unsets:
        update["$unset"] = unsets
    res = await get_db().usuarios.update_one(filtro_gestionable, update)
    if res.matched_count == 0:
        raise HTTPException(404, "Usuario no encontrado")
    actualizado = await get_db().usuarios.find_one({"_id": oid}, PROYECCION)
    if actualizado is not None:
        await registrar_auditoria(
            actor=usuario,
            accion="editar",
            recurso="usuarios",
            recurso_id=usuario_id,
            antes=actual,
            despues=actualizado,
        )
    return a_json(actualizado)
