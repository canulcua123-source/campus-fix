"""Utilidades compartidas por la suite e2e."""
import copy
import uuid
from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from httpx import AsyncClient

from app.core.security import crear_access_token, hashear_password

PASSWORD = "Password-E2E-123"

DETALLES = {
    "computo_redes": {
        "categoria": "computo_redes", "ip": "10.0.0.5", "vlan": 20,
        "puerto_uplink": "Gi0/1", "equipos_afectados": 3,
    },
    "infraestructura": {
        "categoria": "infraestructura", "tipo_dano": "electrico", "riesgo_seguridad": "medio",
        "requiere_insumos": True, "insumos": ["cable"], "requiere_contratista": False,
    },
    "academico": {
        "categoria": "academico", "plataforma": "lms", "codigo_curso": "MAT-101",
        "periodo": "2026-2", "estudiantes_impactados": 30,
    },
}

# Ruta (vía API) para llevar una incidencia "abierta" a cada estado.
RUTAS = {
    "abierta": [],
    "en_proceso": ["en_proceso"],
    "en_espera": ["en_espera"],
    "resuelta": ["en_proceso", "resuelta"],
    "cerrada": ["en_proceso", "resuelta", "cerrada"],
}


class ClienteSeguro(AsyncClient):
    """AsyncClient que verifica que ninguna respuesta filtre `password_hash`."""

    async def request(self, *args, **kwargs):
        r = await super().request(*args, **kwargs)
        assert "password_hash" not in r.text, f"password_hash filtrado en {r.request.method} {r.request.url}"
        return r


def cuerpo(categoria: str = "infraestructura", *, edificio: str = "Edificio A", **over) -> dict:
    b = {
        "titulo": f"Falla de prueba {categoria}",
        "descripcion": "Descripción suficientemente larga para la prueba e2e.",
        "prioridad": "media",
        "ubicacion": {"edificio": edificio, "piso": 1, "aula": "101"},
        "detalle_especifico": copy.deepcopy(DETALLES[categoria]),
        "tags": ["prueba"],
    }
    b.update(over)
    return b


def sin_nulos(obj: Any, ruta: str = "") -> list[str]:
    if obj is None:
        return [ruta or "<raiz>"]
    if isinstance(obj, dict):
        return [p for k, v in obj.items() for p in sin_nulos(v, f"{ruta}.{k}")]
    if isinstance(obj, list):
        return [p for i, v in enumerate(obj) for p in sin_nulos(v, f"{ruta}[{i}]")]
    return []


async def sembrar_usuarios(db, admin: dict) -> dict[str, dict]:
    await db.roles.insert_many([
        {"clave": "jefe_edificio", "nombre": "Jefe de edificio", "descripcion": "e2e",
         "permisos": ["incidencias:ver", "incidencias:buscar", "seguimiento:registrar", "tags:gestionar"],
         "alcance": "edificio", "sistema": False},
        {"clave": "gestor_roles", "nombre": "Gestor de roles", "descripcion": "e2e",
         "permisos": ["roles:gestionar", "incidencias:ver"], "alcance": "global", "sistema": False},
    ])
    h = hashear_password(PASSWORD)
    defs = {
        "reportante_a": ("reportante", [], [], True),
        "reportante_b": ("reportante", [], [], True),
        "tecnico_infra": ("tecnico", ["infraestructura"], [], True),
        "tecnico_infra2": ("tecnico", ["infraestructura"], [], True),
        "tecnico_redes": ("tecnico", ["computo_redes"], [], True),
        "tecnico_inactivo": ("tecnico", ["infraestructura"], [], False),
        "coordinador_infra": ("coordinador", ["infraestructura"], [], True),
        "directivo": ("directivo", [], [], True),
        "inactivo": ("reportante", [], [], False),
        "jefe_a": ("jefe_edificio", [], ["Edificio A"], True),
        "gestor": ("gestor_roles", [], [], True),
    }
    usuarios: dict[str, dict] = {}
    for nombre, (rol, areas, edificios, activo) in defs.items():
        doc = {
            "schema_version": 1,
            "correo": f"{nombre}@e2e.local", "nombre": nombre.replace("_", " ").title(), "rol": rol,
            "password_hash": h, "activo": activo, "areas": areas, "edificios": edificios,
            "fecha_alta": datetime.now(timezone.utc),
        }
        res = await db.usuarios.insert_one(doc)
        usuarios[nombre] = {"_id": res.inserted_id, "correo": doc["correo"], "nombre": doc["nombre"], "rol": rol,
                            "token": crear_access_token(str(res.inserted_id))}
    usuarios["admin"] = {"_id": admin["_id"], "correo": admin["correo"], "nombre": admin["nombre"], "rol": "admin",
                         "token": crear_access_token(str(admin["_id"])), "password": "AdminE2E-Password1"}
    return usuarios


class Api:
    def __init__(self, client: ClienteSeguro, usuarios: dict[str, dict], db):
        self.c = client
        self.u = usuarios
        self.db = db

    def h(self, quien: str) -> dict:
        return {"Authorization": f"Bearer {self.u[quien]['token']}"}

    def oid(self, quien: str) -> ObjectId:
        return self.u[quien]["_id"]

    async def crear(self, quien: str = "reportante_a", categoria: str = "infraestructura", **kw) -> dict:
        r = await self.c.post("/incidencias", json=cuerpo(categoria, **kw), headers=self.h(quien))
        assert r.status_code == 201, r.text
        return r.json()

    async def doc(self, inc_id: str) -> dict:
        return await self.db.incidencias_campus.find_one({"_id": ObjectId(inc_id)})

    async def seguimiento(self, inc_id: str, estado: str, quien: str = "admin", horas: float = 1, comentario: str = "Avance de prueba"):
        return await self.c.patch(
            f"/incidencias/{inc_id}/seguimiento",
            json={"estado_nuevo": estado, "comentario": comentario, "horas": horas},
            headers=self.h(quien),
        )

    async def a_estado(self, inc_id: str, estado: str) -> None:
        for e in RUTAS[estado]:
            r = await self.seguimiento(inc_id, e)
            assert r.status_code == 200, f"{e}: {r.status_code} {r.text}"

    async def crear_en(self, estado: str, quien: str = "reportante_a", categoria: str = "infraestructura", **kw) -> dict:
        inc = await self.crear(quien, categoria, **kw)
        await self.a_estado(inc["_id"], estado)
        return inc

    async def usuario_temporal(self, rol: str = "reportante", **extra) -> dict:
        doc = {"schema_version": 1, "correo": f"tmp_{uuid.uuid4().hex[:10]}@e2e.local",
               "nombre": "Temporal E2E", "rol": rol,
               "password_hash": hashear_password(PASSWORD), "activo": True, "areas": [], "edificios": [],
               "fecha_alta": datetime.now(timezone.utc), **extra}
        res = await self.db.usuarios.insert_one(doc)
        return {"_id": res.inserted_id, "correo": doc["correo"], "token": crear_access_token(str(res.inserted_id))}
