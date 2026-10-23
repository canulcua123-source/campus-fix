"""Inicializa MongoDB: colecciones con $jsonSchema, índices y datos semilla (idempotente).

Uso:  python scripts/init_db.py [--seed-demo]
"""
import asyncio
import os
import random
import uuid
import secrets
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pymongo import ASCENDING, DESCENDING, AsyncMongoClient  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.security import hashear_password  # noqa: E402
from app.schemas.rol import CATALOGO_PERMISOS  # noqa: E402

CATEGORIAS = ["computo_redes", "infraestructura", "academico"]
ESTADOS = ["abierta", "en_proceso", "en_espera", "resuelta", "cerrada"]
PRIORIDADES = ["baja", "media", "alta", "critica"]
TIPOS_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"]
ALCANCES = ["propio", "area", "edificio", "global"]
TIPOS_REPORTANTE = ["docente", "estudiante", "administrativo"]


def esquema_usuarios() -> dict:
    return {
        "$jsonSchema": {
            "bsonType": "object",
            "required": [
                "schema_version", "correo", "nombre", "password_hash", "rol", "activo", "fecha_alta",
            ],
            "additionalProperties": False,
            "properties": {
                "_id": {"bsonType": "objectId"},
                "schema_version": {"bsonType": "int", "enum": [1]},
                "correo": {
                    "bsonType": "string",
                    "maxLength": 254,
                    "pattern": r"^[^@\s]+@[^@\s]+\.[^@\s]+$",
                },
                "nombre": {"bsonType": "string", "minLength": 3, "maxLength": 80},
                "password_hash": {"bsonType": "string", "minLength": 1},
                "rol": {"bsonType": "string", "pattern": r"^[a-z_]{3,30}$"},
                "activo": {"bsonType": "bool"},
                "areas": {
                    "bsonType": "array",
                    "maxItems": 3,
                    "uniqueItems": True,
                    "items": {"enum": CATEGORIAS},
                },
                "edificios": {
                    "bsonType": "array",
                    "maxItems": 20,
                    "uniqueItems": True,
                    "items": {"bsonType": "string", "minLength": 1, "maxLength": 60},
                },
                "tipo_reportante": {"enum": TIPOS_REPORTANTE},
                "fecha_alta": {"bsonType": "date"},
            },
        }
    }


def esquema_roles() -> dict:
    return {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["clave", "nombre", "descripcion", "permisos", "alcance"],
            "additionalProperties": False,
            "properties": {
                "_id": {"bsonType": "objectId"},
                "clave": {"bsonType": "string", "pattern": r"^[a-z_]{3,30}$"},
                "nombre": {"bsonType": "string", "minLength": 3, "maxLength": 50},
                "descripcion": {"bsonType": "string", "maxLength": 200},
                "permisos": {
                    "bsonType": "array",
                    "minItems": 1,
                    "maxItems": len(CATALOGO_PERMISOS),
                    "uniqueItems": True,
                    "items": {"enum": CATALOGO_PERMISOS},
                },
                "alcance": {"enum": ALCANCES},
                "sistema": {"bsonType": "bool"},
            },
        }
    }


def _campo_categoria(tipo: str, propiedades: dict | None = None, requeridos: list[str] | None = None) -> dict:
    return {
        "bsonType": "object",
        "required": ["nombre", "tipo", "requerido", *(requeridos or [])],
        "additionalProperties": False,
        "properties": {
            "nombre": {"bsonType": "string", "pattern": r"^[a-z_][a-z0-9_]{0,49}$"},
            "tipo": {"enum": [tipo]},
            "requerido": {"bsonType": "bool"},
            **(propiedades or {}),
        },
    }


def esquema_categorias() -> dict:
    numero = {"bsonType": ["int", "long", "double"]}
    return {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["clave", "nombre", "prefijo", "area_responsable", "version", "activa", "campos"],
            "additionalProperties": False,
            "properties": {
                "_id": {"bsonType": "objectId"},
                "clave": {"enum": CATEGORIAS},
                "nombre": {"bsonType": "string", "minLength": 3, "maxLength": 80},
                "prefijo": {"bsonType": "string", "pattern": r"^[A-Z]{3}$"},
                "area_responsable": {"bsonType": "string", "minLength": 3, "maxLength": 100},
                "version": {"bsonType": "int", "minimum": 1},
                "activa": {"bsonType": "bool"},
                "campos": {
                    "bsonType": "array",
                    "minItems": 1,
                    "maxItems": 30,
                    "uniqueItems": True,
                    "items": {
                        "oneOf": [
                            _campo_categoria("ip"),
                            _campo_categoria("booleano"),
                            _campo_categoria("lista_texto"),
                            _campo_categoria("entero", {"min": numero, "max": numero}),
                            _campo_categoria(
                                "texto",
                                {
                                    "max_length": {"bsonType": "int", "minimum": 1},
                                    "patron": {"bsonType": "string", "minLength": 1},
                                },
                            ),
                            _campo_categoria(
                                "enum",
                                {
                                    "opciones": {
                                        "bsonType": "array",
                                        "minItems": 1,
                                        "uniqueItems": True,
                                        "items": {"bsonType": "string", "minLength": 1},
                                    }
                                },
                                ["opciones"],
                            ),
                        ]
                    },
                },
            },
        }
    }


def _detalle(categoria: str, props: dict, requeridos: list[str]) -> dict:
    return {
        "bsonType": "object",
        "required": ["categoria", *requeridos],
        "additionalProperties": False,
        "properties": {"categoria": {"enum": [categoria]}, **props},
    }


def esquema_incidencias() -> dict:
    return {
        "$jsonSchema": {
            "bsonType": "object",
            "required": [
                "schema_version", "codigo", "titulo", "descripcion", "categoria", "estado",
                "prioridad", "ubicacion", "reportante", "detalle_especifico",
                "fecha_creacion", "fecha_actualizacion", "tags", "historial_seguimiento",
                "evidencias_adjuntas", "horas_invertidas",
            ],
            "properties": {
                "schema_version": {"bsonType": "int"},
                "codigo": {"bsonType": "string"},
                "titulo": {"bsonType": "string", "minLength": 5, "maxLength": 120},
                "descripcion": {"bsonType": "string", "minLength": 10, "maxLength": 2000},
                "categoria": {"enum": CATEGORIAS},
                "estado": {"enum": ESTADOS},
                "prioridad": {"enum": PRIORIDADES},
                "ubicacion": {
                    "bsonType": "object",
                    "required": ["edificio", "aula"],
                    "properties": {
                        "edificio": {"bsonType": "string"},
                        "piso": {"bsonType": ["int", "long"]},
                        "aula": {"bsonType": "string"},
                    },
                },
                "reportante": {
                    "bsonType": "object",
                    "required": ["usuario_id"],
                    "properties": {"usuario_id": {"bsonType": "objectId"}, "nombre": {"bsonType": "string"}},
                },
                "tecnico_asignado": {"bsonType": "object", "required": ["usuario_id"]},
                "horas_invertidas": {"bsonType": ["int", "long", "double"], "minimum": 0},
                "fecha_creacion": {"bsonType": "date"},
                "fecha_actualizacion": {"bsonType": "date"},
                "fecha_resolucion": {"bsonType": "date"},
                "tags": {"bsonType": "array", "maxItems": 15, "uniqueItems": True, "items": {"bsonType": "string"}},
                "historial_seguimiento": {"bsonType": "array"},
                "evidencias_adjuntas": {
                    "bsonType": "array",
                    "maxItems": 10,
                    "items": {
                        "bsonType": "object",
                        "required": ["nombre_archivo", "tipo_mime", "peso_kb", "url_storage", "fecha_carga"],
                        "properties": {
                            "nombre_archivo": {"bsonType": "string"},
                            "tipo_mime": {"enum": TIPOS_MIME},
                            "peso_kb": {"bsonType": ["int", "long", "double"], "maximum": 10240},
                            "url_storage": {"bsonType": "string"},
                            "fecha_carga": {"bsonType": "date"},
                        },
                    },
                },
                "detalle_especifico": {
                    "oneOf": [
                        _detalle("computo_redes", {
                            "ip": {"bsonType": "string"},
                            "vlan": {"bsonType": "int", "minimum": 1, "maximum": 4094},
                            "puerto_uplink": {"bsonType": "string", "maxLength": 20},
                            "equipos_afectados": {"bsonType": "int", "minimum": 1},
                        }, ["ip", "vlan", "puerto_uplink", "equipos_afectados"]),
                        _detalle("infraestructura", {
                            "tipo_dano": {"enum": ["filtracion", "electrico", "climatizacion", "cerrajeria", "luminaria", "otro"]},
                            "riesgo_seguridad": {"enum": ["bajo", "medio", "alto"]},
                            "requiere_insumos": {"bsonType": "bool"},
                            "insumos": {"bsonType": "array", "items": {"bsonType": "string"}},
                            "requiere_contratista": {"bsonType": "bool"},
                        }, ["tipo_dano", "riesgo_seguridad", "requiere_insumos", "requiere_contratista"]),
                        _detalle("academico", {
                            "plataforma": {"enum": ["lms", "portal_calificaciones", "correo"]},
                            "codigo_curso": {"bsonType": "string", "pattern": r"^[A-Z]{2,4}-\d{3}$"},
                            "periodo": {"bsonType": "string", "pattern": r"^\d{4}-[12]$"},
                            "estudiantes_impactados": {"bsonType": "int", "minimum": 0},
                        }, ["plataforma", "codigo_curso", "periodo", "estudiantes_impactados"]),
                    ]
                },
            },
        },
        # La categoría del ticket debe coincidir con la del detalle polimórfico
        "$expr": {"$eq": ["$categoria", "$detalle_especifico.categoria"]},
    }


async def asegurar_coleccion(db, nombre: str, validador: dict | None = None) -> None:
    existentes = await db.list_collection_names()
    if nombre not in existentes:
        opciones = {"validator": validador, "validationLevel": "strict", "validationAction": "error"} if validador else {}
        await db.create_collection(nombre, **opciones)
        print(f"+ colección {nombre}")
    elif validador:
        await db.command("collMod", nombre, validator=validador, validationLevel="strict", validationAction="error")
        print(f"~ validador actualizado en {nombre}")


async def crear_indices(db) -> None:
    inc = db.incidencias_campus
    await inc.create_index([("categoria", ASCENDING), ("estado", ASCENDING), ("ubicacion.edificio", ASCENDING)])
    await inc.create_index("fecha_resolucion", expireAfterSeconds=60 * 24 * 3600)
    await inc.create_index(
        [("titulo", "text"), ("descripcion", "text")],
        weights={"titulo": 10, "descripcion": 5},
        default_language="spanish",
        name="texto_titulo_descripcion",
    )
    await inc.create_index("codigo", unique=True)
    await inc.create_index([("reportante.usuario_id", ASCENDING), ("fecha_creacion", DESCENDING)])
    await inc.create_index([("tecnico_asignado.usuario_id", ASCENDING), ("estado", ASCENDING)])
    await inc.create_index([("estado", ASCENDING), ("ubicacion.edificio", ASCENDING)])  # Pipeline 1
    await inc.create_index([("fecha_creacion", -1)])  # listados recientes
    await db.usuarios.create_index("correo", unique=True)
    await db.roles.create_index("clave", unique=True)
    await db.categorias.create_index("clave", unique=True)


def roles_sistema() -> list[dict]:
    reportante = ["incidencias:crear", "incidencias:ver", "evidencias:subir", "ia:usar"]
    tecnico = [*reportante, "seguimiento:registrar", "tags:gestionar", "incidencias:buscar"]
    coordinador = [*tecnico, "incidencias:asignar", "analitica:ver"]
    directivo = ["incidencias:ver", "incidencias:buscar", "analitica:ver"]
    d = lambda clave, nombre, permisos, alcance: {  # noqa: E731
        "clave": clave, "nombre": nombre, "descripcion": f"Rol de sistema: {nombre}",
        "permisos": permisos, "alcance": alcance, "sistema": True,
    }
    return [
        d("reportante", "Reportante", reportante, "propio"),
        d("tecnico", "Técnico", tecnico, "area"),
        d("coordinador", "Coordinador", coordinador, "area"),
        d("directivo", "Directivo", directivo, "global"),
        d("admin", "Administrador", list(CATALOGO_PERMISOS), "global"),
    ]


def categorias_sistema() -> list[dict]:
    campo = lambda nombre, tipo, **extra: {"nombre": nombre, "tipo": tipo, **extra}  # noqa: E731
    return [
        {"clave": "computo_redes", "nombre": "Cómputo y redes", "prefijo": "RED", "area_responsable": "Tecnologías de la Información",
         "version": 1, "activa": True, "campos": [
             campo("ip", "ip", requerido=True), campo("vlan", "entero", requerido=True, min=1, max=4094),
             campo("puerto_uplink", "texto", requerido=True, max_length=20),
             campo("equipos_afectados", "entero", requerido=True, min=1)]},
        {"clave": "infraestructura", "nombre": "Infraestructura", "prefijo": "INF", "area_responsable": "Servicios Generales",
         "version": 1, "activa": True, "campos": [
             campo("tipo_dano", "enum", requerido=True, opciones=["filtracion", "electrico", "climatizacion", "cerrajeria", "luminaria", "otro"]),
             campo("riesgo_seguridad", "enum", requerido=True, opciones=["bajo", "medio", "alto"]),
             campo("requiere_insumos", "booleano", requerido=True), campo("insumos", "lista_texto", requerido=False),
             campo("requiere_contratista", "booleano", requerido=True)]},
        {"clave": "academico", "nombre": "Académico", "prefijo": "ACA", "area_responsable": "Servicios Escolares",
         "version": 1, "activa": True, "campos": [
             campo("plataforma", "enum", requerido=True, opciones=["lms", "portal_calificaciones", "correo"]),
             campo("codigo_curso", "texto", requerido=True, patron=r"^[A-Z]{2,4}-\d{3}$"),
             campo("periodo", "texto", requerido=True, patron=r"^\d{4}-[12]$"),
             campo("estudiantes_impactados", "entero", requerido=True, min=0)]},
    ]


async def sembrar_base(db) -> dict:
    for rol in roles_sistema():
        await db.roles.update_one({"clave": rol["clave"]}, {"$setOnInsert": rol}, upsert=True)
    for cat in categorias_sistema():
        await db.categorias.update_one({"clave": cat["clave"]}, {"$setOnInsert": cat}, upsert=True)
    admin = await db.usuarios.find_one({"correo": "admin@utm.local"})
    if admin is None:
        local = "localhost" in (settings.mongodb_admin_uri or settings.mongodb_uri)
        if not local and not os.environ.get("SEED_ADMIN_PASSWORD"):
            raise SystemExit("Define SEED_ADMIN_PASSWORD para crear el admin fuera del entorno local")
        password = os.environ.get("SEED_ADMIN_PASSWORD") or secrets.token_urlsafe(12)
        generado = "SEED_ADMIN_PASSWORD" not in os.environ or not os.environ["SEED_ADMIN_PASSWORD"]
        admin = {
            "schema_version": 1,
            "correo": "admin@utm.local", "nombre": "Administrador", "rol": "admin",
            "password_hash": hashear_password(password), "activo": True,
            "areas": [], "edificios": [], "fecha_alta": datetime.now(timezone.utc),
        }
        res = await db.usuarios.insert_one(admin)
        admin["_id"] = res.inserted_id
        print("+ usuario admin@utm.local")
        if generado:
            print("! contraseña local generada; define SEED_ADMIN_PASSWORD para controlar su valor")
    return admin


EDIFICIOS = ["A", "B", "C", "Biblioteca", "Laboratorios"]


def _detalle_demo(rnd: random.Random, categoria: str) -> dict:
    if categoria == "computo_redes":
        return {"categoria": categoria, "ip": f"10.{rnd.randint(0, 20)}.{rnd.randint(0, 250)}.{rnd.randint(2, 250)}",
                "vlan": rnd.choice([10, 20, 30, 99]), "puerto_uplink": f"Gi0/{rnd.randint(1, 24)}",
                "equipos_afectados": rnd.randint(1, 40)}
    if categoria == "infraestructura":
        return {"categoria": categoria,
                "tipo_dano": rnd.choice(["filtracion", "electrico", "climatizacion", "cerrajeria", "luminaria", "otro"]),
                "riesgo_seguridad": rnd.choice(["bajo", "medio", "alto"]), "requiere_insumos": True,
                "insumos": ["cable", "cinta aislante"], "requiere_contratista": rnd.random() < 0.3}
    return {"categoria": categoria, "plataforma": rnd.choice(["lms", "portal_calificaciones", "correo"]),
            "codigo_curso": f"{rnd.choice(['MAT', 'FIS', 'ISC'])}-{rnd.randint(100, 499)}",
            "periodo": "2026-2", "estudiantes_impactados": rnd.randint(0, 120)}


TITULOS = {
    "computo_redes": ["Sin conexión en el laboratorio", "Switch de piso reiniciándose", "WiFi intermitente en aula"],
    "infraestructura": ["Luminaria fundida en pasillo", "Filtración en techo del aula", "Aire acondicionado no enfría"],
    "academico": ["Error al subir tareas al LMS", "Calificaciones no visibles en portal", "Correo institucional rechaza mensajes"],
}


RUTAS_DEMO = {
    "abierta": [],
    "en_proceso": ["en_proceso"],
    "en_espera": ["en_proceso", "en_espera"],
    "resuelta": ["en_proceso", "resuelta"],
    "cerrada": ["en_proceso", "resuelta", "cerrada"],
}


async def sembrar_demo(db, admin: dict, reiniciar: bool = False) -> None:
    if reiniciar:
        borradas = (await db.incidencias_campus.delete_many({"demo": True})).deleted_count
        print(f"- {borradas} incidencias demo eliminadas")
    elif await db.incidencias_campus.count_documents({"demo": True}):
        print("= demo ya sembrado (usa --reset-demo para regenerarlo)")
        return
    rnd = random.Random(42)
    ahora = datetime.now(timezone.utc)
    prefijos = {"computo_redes": "RED", "infraestructura": "INF", "academico": "ACA"}
    tags_pool = ["red", "wifi", "switch", "luminaria", "filtracion", "lms", "calificaciones", "aire_acondicionado", "urgente", "laboratorio"]
    docs = []
    for i in range(24):
        categoria = CATEGORIAS[i % 3]
        estado = "resuelta" if i < 8 else ESTADOS[i % 5]  # >= 8 resueltas garantizadas
        # Fechas dentro de los últimos 30 días: el TTL de 60 días no las borra antes de la defensa.
        creada = ahora - timedelta(days=rnd.randint(5, 30), hours=rnd.randint(0, 20))
        codigo = f"INC-{creada:%Y}-{creada:%m%d}-{prefijos[categoria]}-{9000 + i}"
        historial = [{"fecha": creada, "usuario_id": admin["_id"], "estado_nuevo": "abierta", "comentario": "Incidencia creada", "horas": 0.0}]
        momento, total_horas = creada, 0.0
        for paso in RUTAS_DEMO[estado]:
            momento = momento + timedelta(hours=rnd.randint(2, 30))
            horas = 0.0 if paso == "cerrada" else float(rnd.randint(1, 4))
            total_horas += horas
            historial.append({"fecha": momento, "usuario_id": admin["_id"], "estado_nuevo": paso,
                              "comentario": f"Cambio a {paso} (demo)", "horas": horas})
            if paso == "resuelta":
                fecha_resolucion = momento
        doc = {
            "schema_version": 1, "demo": True, "codigo": codigo,
            "titulo": rnd.choice(TITULOS[categoria]),
            "descripcion": "Incidencia sintética generada para demostración del sistema UTM Desk.",
            "categoria": categoria, "estado": estado, "prioridad": PRIORIDADES[i % 4],
            "ubicacion": {"edificio": EDIFICIOS[i % 5], "piso": rnd.randint(1, 3), "aula": f"{rnd.randint(1, 3)}0{rnd.randint(1, 9)}"},
            "reportante": {"usuario_id": admin["_id"], "nombre": admin["nombre"]},
            "detalle_especifico": _detalle_demo(rnd, categoria),
            "tags": rnd.sample(tags_pool, rnd.randint(2, 4)),
            "evidencias_adjuntas": [],
            "horas_invertidas": total_horas,
            "historial_seguimiento": historial,
            "fecha_creacion": creada, "fecha_actualizacion": momento,
        }
        if estado in ("resuelta", "cerrada"):
            doc["fecha_resolucion"] = fecha_resolucion
        if i < 18:  # >= 15 con evidencias
            evidencia_id = str(uuid.UUID(int=rnd.getrandbits(128), version=4))
            doc["evidencias_adjuntas"] = [{
                "evidencia_id": evidencia_id, "nombre_archivo": f"evidencia_{i}.jpg", "tipo_mime": "image/jpeg",
                "peso_kb": rnd.randint(200, 1500), "url_storage": f"evidencias/{codigo}/{evidencia_id}.jpg",
                "fecha_carga": creada, "subido_por": admin["_id"],
            }]
        docs.append(doc)
    await db.incidencias_campus.insert_many(docs)
    print(f"+ {len(docs)} incidencias demo")


async def main() -> None:
    cliente = AsyncMongoClient(settings.mongodb_admin_uri or settings.mongodb_uri)
    db = cliente[settings.mongodb_db]
    try:
        await asegurar_coleccion(db, "incidencias_campus", esquema_incidencias())
        for nombre, validador in (
            ("usuarios", esquema_usuarios()),
            ("roles", esquema_roles()),
            ("categorias", esquema_categorias()),
        ):
            await asegurar_coleccion(db, nombre, validador)
        await crear_indices(db)
        admin = await sembrar_base(db)
        if "--seed-demo" in sys.argv or "--reset-demo" in sys.argv:
            await sembrar_demo(db, admin, reiniciar="--reset-demo" in sys.argv)
        print("OK: base de datos lista")
    finally:
        await cliente.close()


if __name__ == "__main__":
    asyncio.run(main())
