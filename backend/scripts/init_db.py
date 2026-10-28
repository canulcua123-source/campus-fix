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
from pymongo.uri_parser import parse_uri  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.security import hashear_password  # noqa: E402
from app.schemas.rol import CATALOGO_PERMISOS  # noqa: E402

CATEGORIAS = ["computo_redes", "infraestructura", "academico"]
PATRON_CATEGORIA = r"^[a-z][a-z0-9_]{2,29}$"
PATRON_CATEGORIA_PERSONALIZADA = r"^(?!(?:computo_redes|infraestructura|academico)$)[a-z][a-z0-9_]{2,29}$"
ESTADOS = ["abierta", "en_proceso", "en_espera", "resuelta", "cerrada", "retirada"]
PRIORIDADES = ["baja", "media", "alta", "critica"]
TIPOS_MIME = [
    "image/jpeg", "image/png", "image/webp", "application/pdf", "video/mp4", "video/quicktime", "video/webm"
]
ALCANCES = ["propio", "area", "edificio", "global"]
TIPOS_REPORTANTE = ["docente", "estudiante", "administrativo"]
EVENTOS_IA = ["ofrecido", "deshecho", "editado", "enviado", "duplicado_sumado", "fallback"]
EVENTOS_FINALES_IA = ["deshecho", "enviado", "duplicado_sumado", "fallback"]
COMPUERTAS_IA = [f"G{numero}" for numero in range(1, 10)]
PATRON_ANALISIS_IA = r"^[A-Za-z0-9_-]{22,64}$"
PATRON_CAMPO_IA = r"^(titulo|descripcion|prioridad|tags|detalle_especifico\.[a-z][a-z0-9_]{0,49})$"


def esquema_ia_sugerencia() -> dict:
    """Subdocumento aditivo que T-029/T-036 podrán escribir desde datos del servidor."""
    campos = {
        "bsonType": "array",
        "maxItems": 15,
        "uniqueItems": True,
        "items": {"bsonType": "string", "pattern": PATRON_CAMPO_IA},
    }
    return {
        "bsonType": "object",
        "required": ["modo", "modelo", "version_prompt", "confianza", "campos_autollenados"],
        "additionalProperties": False,
        "properties": {
            "modo": {"enum": ["agentico", "asistido"]},
            "modelo": {
                "bsonType": "string",
                "minLength": 1,
                "maxLength": 100,
                "pattern": r"^[A-Za-z0-9._:/-]+$",
            },
            "version_prompt": {
                "bsonType": "string",
                "minLength": 1,
                "maxLength": 40,
                "pattern": r"^[A-Za-z0-9._-]+$",
            },
            "confianza": {"bsonType": ["double", "decimal"], "minimum": 0, "maximum": 1},
            "campos_autollenados": campos,
            "proveedor": {
                "bsonType": "string",
                "minLength": 2,
                "maxLength": 30,
                "pattern": r"^[a-z][a-z0-9_-]+$",
            },
            "analisis_id": {"bsonType": "string", "pattern": PATRON_ANALISIS_IA},
            "accion": {
                "enum": [
                    "agentico",
                    "formulario",
                    "duplicado",
                    "autollenar",
                    "sugerir",
                    "preguntar",
                    "rechazar",
                ]
            },
            "campos_editados_por_usuario": campos,
            "compuertas_fallidas": {
                "bsonType": "array",
                "maxItems": 9,
                "uniqueItems": True,
                "items": {"enum": COMPUERTAS_IA},
            },
            "ubicacion_fuente": {"enum": ["qr", "confirmada", "selector"]},
        },
    }


def esquema_ia_eventos() -> dict:
    """Una fila por oferta; el resultado final se decide con actualización atómica."""
    propiedades = {
        "_id": {"bsonType": "objectId"},
        "analisis_id": {"bsonType": "string", "pattern": PATRON_ANALISIS_IA},
        "actor_clave": {"bsonType": "string", "pattern": r"^[0-9a-f]{64}$"},
        "evento": {"enum": EVENTOS_IA},
        "resultado_final": {"enum": EVENTOS_FINALES_IA},
        "fecha": {"bsonType": "date"},
        "fecha_evento": {"bsonType": "date"},
        "fecha_final": {"bsonType": "date"},
        "oferta_expira_en": {"bsonType": "date"},
        "editado": {"bsonType": "bool"},
        "modo": {"enum": ["agentico", "asistido"]},
        "modelo": {
            "bsonType": "string",
            "minLength": 1,
            "maxLength": 100,
            "pattern": r"^[A-Za-z0-9._:/-]+$",
        },
        "version_prompt": {
            "bsonType": "string",
            "minLength": 1,
            "maxLength": 40,
            "pattern": r"^[A-Za-z0-9._-]+$",
        },
        "confianza": {"bsonType": ["double", "decimal"], "minimum": 0, "maximum": 1},
        "campos_autollenados": {
            "bsonType": "array",
            "maxItems": 15,
            "uniqueItems": True,
            "items": {"bsonType": "string", "pattern": PATRON_CAMPO_IA},
        },
        "proveedor": {
            "bsonType": "string",
            "minLength": 2,
            "maxLength": 30,
            "pattern": r"^[a-z][a-z0-9_-]+$",
        },
        "categoria": {"bsonType": "string", "pattern": PATRON_CATEGORIA},
        "accion": {
            "enum": [
                "agentico",
                "formulario",
                "duplicado",
                "autollenar",
                "sugerir",
                "preguntar",
                "rechazar",
            ]
        },
        "campos_editados_por_usuario": {
            "bsonType": "array",
            "maxItems": 15,
            "uniqueItems": True,
            "items": {"bsonType": "string", "pattern": PATRON_CAMPO_IA},
        },
        "compuertas_fallidas": {
            "bsonType": "array",
            "maxItems": 9,
            "uniqueItems": True,
            "items": {"enum": COMPUERTAS_IA},
        },
        "ubicacion_fuente": {"enum": ["qr", "confirmada", "selector"]},
        "latencia_ia_ms": {"bsonType": ["int", "long"], "minimum": 0, "maximum": 300000},
        "tokens_entrada": {"bsonType": ["int", "long"], "minimum": 0},
        "tokens_salida": {"bsonType": ["int", "long"], "minimum": 0},
        "costo_estimado_usd": {
            "bsonType": ["int", "long", "double", "decimal"],
            "minimum": 0,
        },
        "resultado_ia": {"enum": ["ok", "error", "timeout"]},
        "motivo": {"enum": ["usuario_deshizo", "usuario_edito", "continuo_manual"]},
        "incidencia_id": {"bsonType": "objectId"},
        "duracion_toque_folio_ms": {
            "bsonType": ["int", "long"],
            "minimum": 0,
            "maximum": 300000,
        },
    }
    return {
        "$jsonSchema": {
            "bsonType": "object",
            "required": [
                "analisis_id",
                "actor_clave",
                "evento",
                "fecha",
                "fecha_evento",
                "oferta_expira_en",
                "editado",
                "modo",
                "modelo",
                "version_prompt",
                "confianza",
                "campos_autollenados",
            ],
            "additionalProperties": False,
            "properties": propiedades,
            "oneOf": [
                {
                    "properties": {"evento": {"enum": ["ofrecido"]}, "editado": {"enum": [False]}},
                    "not": {"anyOf": [{"required": ["resultado_final"]}, {"required": ["fecha_final"]}]},
                },
                {
                    "properties": {"evento": {"enum": ["editado"]}, "editado": {"enum": [True]}},
                    "not": {"anyOf": [{"required": ["resultado_final"]}, {"required": ["fecha_final"]}]},
                },
                *[
                    {
                        "required": ["resultado_final", "fecha_final"],
                        "properties": {
                            "evento": {"enum": [evento]},
                            "resultado_final": {"enum": [evento]},
                        },
                    }
                    for evento in EVENTOS_FINALES_IA
                ],
            ],
        }
    }


def esquema_huellas_reportes() -> dict:
    """Huella tecnica temporal; deliberadamente no contiene datos personales ni fotos."""
    return {
        "$jsonSchema": {
            "bsonType": "object",
            "required": [
                "aula_id",
                "categoria",
                "sha256",
                "dhash",
                "incidencia_id",
                "codigo",
                "fecha",
                "elegible",
            ],
            "additionalProperties": False,
            "properties": {
                "_id": {"bsonType": "objectId"},
                "aula_id": {"bsonType": "string", "pattern": r"^[A-Za-z0-9_-]{22}$"},
                "categoria": {"bsonType": "string", "pattern": PATRON_CATEGORIA},
                "sha256": {"bsonType": "string", "pattern": r"^[0-9a-f]{64}$"},
                "dhash": {"bsonType": "string", "pattern": r"^[0-9a-f]{16}$"},
                "incidencia_id": {"bsonType": "objectId"},
                "codigo": {"bsonType": "string", "minLength": 1, "maxLength": 64},
                "fecha": {"bsonType": "date"},
                "elegible": {"bsonType": "bool"},
            },
        }
    }


def esquema_coincidencias_duplicados() -> dict:
    """Capacidad opaca, temporal y ligada a un actor mediante HMAC."""
    return {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["_id", "huella_id", "actor_clave", "fecha", "expira_en"],
            "additionalProperties": False,
            "properties": {
                "_id": {"bsonType": "string", "pattern": r"^[A-Za-z0-9_-]{43}$"},
                "huella_id": {"bsonType": "objectId"},
                "actor_clave": {"bsonType": "string", "pattern": r"^[0-9a-f]{64}$"},
                "fecha": {"bsonType": "date"},
                "expira_en": {"bsonType": "date"},
            },
        }
    }


def esquema_adhesiones_reportes() -> dict:
    """Una fila por usuario/reporte; el _id HMAC evita PII y hace idempotente la escritura."""
    return {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["_id", "incidencia_id", "codigo", "categoria", "fecha"],
            "additionalProperties": False,
            "properties": {
                "_id": {"bsonType": "string", "pattern": r"^[0-9a-f]{64}$"},
                "incidencia_id": {"bsonType": "objectId"},
                "codigo": {"bsonType": "string", "minLength": 1, "maxLength": 64},
                "categoria": {"bsonType": "string", "pattern": PATRON_CATEGORIA},
                "fecha": {"bsonType": "date"},
            },
        }
    }


def esquema_aulas() -> dict:
    return {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["id_publico", "edificio", "piso", "aula", "activa", "fecha_creacion"],
            "additionalProperties": False,
            "properties": {
                "_id": {"bsonType": "objectId"},
                "id_publico": {"bsonType": "string", "pattern": r"^[A-Za-z0-9_-]{22}$"},
                "edificio": {"bsonType": "string", "minLength": 1, "maxLength": 60},
                "piso": {"bsonType": ["int", "long"], "minimum": -5, "maximum": 50},
                "aula": {"bsonType": "string", "minLength": 1, "maxLength": 60},
                "activa": {"bsonType": "bool"},
                "fecha_creacion": {"bsonType": "date"},
            },
        }
    }


def esquema_usuarios() -> dict:
    return {
        "$jsonSchema": {
            "bsonType": "object",
            "required": [
                "schema_version",
                "correo",
                "nombre",
                "password_hash",
                "rol",
                "activo",
                "fecha_alta",
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


def _resumen_auditoria_usuario() -> dict:
    return {
        "bsonType": "object",
        "required": ["rol", "activo"],
        "additionalProperties": False,
        "properties": {
            "rol": {"bsonType": "string", "pattern": r"^[a-z_]{3,30}$"},
            "activo": {"bsonType": "bool"},
            "areas": {
                "bsonType": "array",
                "maxItems": 3,
                "uniqueItems": True,
                "items": {"bsonType": "string", "minLength": 1, "maxLength": 60},
            },
            "edificios": {
                "bsonType": "array",
                "maxItems": 20,
                "uniqueItems": True,
                "items": {"bsonType": "string", "minLength": 1, "maxLength": 60},
            },
            "tipo_reportante": {"enum": TIPOS_REPORTANTE},
        },
    }


def _resumen_auditoria_rol() -> dict:
    return {
        "bsonType": "object",
        "required": ["clave", "alcance", "cantidad_permisos"],
        "additionalProperties": False,
        "properties": {
            "clave": {"bsonType": "string", "pattern": r"^[a-z_]{3,30}$"},
            "alcance": {"enum": ALCANCES},
            "cantidad_permisos": {"bsonType": "int", "minimum": 0, "maximum": len(CATALOGO_PERMISOS)},
            "sistema": {"bsonType": "bool"},
        },
    }


def _resumen_auditoria_categoria() -> dict:
    return {
        "bsonType": "object",
        "required": ["clave", "version", "activa", "prefijo", "cantidad_campos"],
        "additionalProperties": False,
        "properties": {
            "clave": {"bsonType": "string", "pattern": PATRON_CATEGORIA},
            "version": {"bsonType": "int", "minimum": 1},
            "activa": {"bsonType": "bool"},
            "prefijo": {"bsonType": "string", "pattern": r"^[A-Z]{3}$"},
            "cantidad_campos": {"bsonType": "int", "minimum": 1, "maximum": 30},
            "sistema": {"bsonType": "bool"},
        },
    }


def _resumen_auditoria_aula() -> dict:
    return {
        "bsonType": "object",
        "required": ["edificio", "piso", "aula", "activa"],
        "additionalProperties": False,
        "properties": {
            "edificio": {"bsonType": "string", "minLength": 1, "maxLength": 60},
            "piso": {"bsonType": ["int", "long"], "minimum": -5, "maximum": 50},
            "aula": {"bsonType": "string", "minLength": 1, "maxLength": 60},
            "activa": {"bsonType": "bool"},
        },
    }


def esquema_auditoria() -> dict:
    """Validador estricto de eventos administrativos resumidos."""
    recursos = (
        ("usuarios", _resumen_auditoria_usuario()),
        ("roles", _resumen_auditoria_rol()),
        ("categorias", _resumen_auditoria_categoria()),
        ("aulas", _resumen_auditoria_aula()),
    )
    return {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["actor_id", "accion", "recurso", "recurso_id", "despues", "fecha"],
            "additionalProperties": False,
            "properties": {
                "_id": {"bsonType": "objectId"},
                "actor_id": {"bsonType": "objectId"},
                "accion": {"enum": ["crear", "editar"]},
                "recurso": {"enum": [recurso for recurso, _ in recursos]},
                "recurso_id": {"bsonType": "string", "minLength": 1, "maxLength": 64},
                "antes": {"bsonType": "object"},
                "despues": {"bsonType": "object"},
                "fecha": {"bsonType": "date"},
            },
            "allOf": [
                {
                    "oneOf": [
                        {
                            "properties": {
                                "recurso": {"enum": [recurso]},
                                "antes": resumen,
                                "despues": resumen,
                            }
                        }
                        for recurso, resumen in recursos
                    ]
                },
                {
                    "oneOf": [
                        {"properties": {"accion": {"enum": ["crear"]}}},
                        {"required": ["antes"], "properties": {"accion": {"enum": ["editar"]}}},
                    ]
                },
            ],
        }
    }


def _campo_categoria(tipo: str, propiedades: dict | None = None, requeridos: list[str] | None = None) -> dict:
    return {
        "bsonType": "object",
        "required": ["nombre", "tipo", "requerido", *(requeridos or [])],
        "additionalProperties": False,
        "properties": {
            "nombre": {"bsonType": "string", "pattern": r"^[a-z_][a-z0-9_]{0,49}$"},
            "etiqueta": {"bsonType": "string", "minLength": 1, "maxLength": 80},
            "tipo": {"enum": [tipo]},
            "requerido": {"bsonType": "bool"},
            **(propiedades or {}),
        },
    }


def esquema_categorias() -> dict:
    numero = {"bsonType": ["int", "long", "double"]}
    entero = {"bsonType": ["int", "long"]}
    opciones = {
        "bsonType": "array",
        "minItems": 1,
        "maxItems": 50,
        "uniqueItems": True,
        "items": {"bsonType": "string", "minLength": 1, "maxLength": 80},
    }
    return {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["clave", "nombre", "prefijo", "area_responsable", "version", "activa", "campos"],
            "additionalProperties": False,
            "properties": {
                "_id": {"bsonType": "objectId"},
                "clave": {"bsonType": "string", "pattern": r"^[a-z][a-z0-9_]{2,29}$"},
                "nombre": {"bsonType": "string", "minLength": 3, "maxLength": 80},
                "prefijo": {"bsonType": "string", "pattern": r"^[A-Z]{3}$"},
                "area_responsable": {"bsonType": "string", "minLength": 3, "maxLength": 100},
                "version": {"bsonType": "int", "minimum": 1},
                "activa": {"bsonType": "bool"},
                "sistema": {"bsonType": "bool"},
                "fecha_creacion": {"bsonType": "date"},
                "fecha_actualizacion": {"bsonType": "date"},
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
                            _campo_categoria("entero", {"min": entero, "max": entero}),
                            _campo_categoria("numero", {"min": numero, "max": numero}),
                            _campo_categoria("lista", {"opciones": opciones}, ["opciones"]),
                            _campo_categoria(
                                "texto",
                                {
                                    "min": {"bsonType": ["int", "long"], "minimum": 0},
                                    "max": {"bsonType": ["int", "long"], "minimum": 0},
                                    "max_length": {"bsonType": "int", "minimum": 1},
                                    "patron": {"bsonType": "string", "minLength": 1},
                                },
                            ),
                            _campo_categoria(
                                "enum",
                                {"opciones": opciones},
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


def _detalle_personalizado() -> dict:
    """Invariantes BSON comunes; la API aplica la definicion dinamica exacta."""
    return {
        "bsonType": "object",
        "required": ["categoria"],
        "additionalProperties": False,
        "properties": {
            "categoria": {"bsonType": "string", "pattern": PATRON_CATEGORIA_PERSONALIZADA},
        },
        "patternProperties": {
            r"^(?!categoria$)[a-z][a-z0-9_]{0,49}$": {
                "bsonType": ["string", "int", "long", "double", "bool"],
            },
        },
    }


def esquema_incidencias() -> dict:
    return {
        "$jsonSchema": {
            "bsonType": "object",
            "required": [
                "schema_version",
                "codigo",
                "titulo",
                "descripcion",
                "categoria",
                "estado",
                "prioridad",
                "ubicacion",
                "reportante",
                "detalle_especifico",
                "fecha_creacion",
                "fecha_actualizacion",
                "tags",
                "historial_seguimiento",
                "evidencias_adjuntas",
                "horas_invertidas",
            ],
            "properties": {
                "schema_version": {"bsonType": "int"},
                "codigo": {"bsonType": "string"},
                "titulo": {"bsonType": "string", "minLength": 5, "maxLength": 120},
                "descripcion": {"bsonType": "string", "minLength": 10, "maxLength": 2000},
                "categoria": {"bsonType": "string", "pattern": PATRON_CATEGORIA},
                "categoria_version": {"bsonType": "int", "minimum": 1},
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
                "ia_sugerencia": esquema_ia_sugerencia(),
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
                            "peso_kb": {"bsonType": ["int", "long", "double"], "maximum": 51200},  # 50 MB (video); fotos y PDF ≤ 10 MB en la API
                            "url_storage": {"bsonType": "string"},
                            "fecha_carga": {"bsonType": "date"},
                        },
                    },
                },
                "detalle_especifico": {
                    "oneOf": [
                        _detalle(
                            "computo_redes",
                            {
                                "ip": {"bsonType": "string"},
                                "vlan": {"bsonType": "int", "minimum": 1, "maximum": 4094},
                                "puerto_uplink": {"bsonType": "string", "maxLength": 20},
                                "equipos_afectados": {"bsonType": "int", "minimum": 1},
                            },
                            ["ip", "vlan", "puerto_uplink", "equipos_afectados"],
                        ),
                        _detalle(
                            "infraestructura",
                            {
                                "tipo_dano": {
                                    "enum": [
                                        "filtracion",
                                        "electrico",
                                        "climatizacion",
                                        "cerrajeria",
                                        "luminaria",
                                        "otro",
                                    ]
                                },
                                "riesgo_seguridad": {"enum": ["bajo", "medio", "alto"]},
                                "requiere_insumos": {"bsonType": "bool"},
                                "insumos": {"bsonType": "array", "items": {"bsonType": "string"}},
                                "requiere_contratista": {"bsonType": "bool"},
                            },
                            ["tipo_dano", "riesgo_seguridad", "requiere_insumos", "requiere_contratista"],
                        ),
                        _detalle(
                            "academico",
                            {
                                "plataforma": {"enum": ["lms", "portal_calificaciones", "correo"]},
                                "codigo_curso": {"bsonType": "string", "pattern": r"^[A-Z]{2,4}-\d{3}$"},
                                "periodo": {"bsonType": "string", "pattern": r"^\d{4}-[12]$"},
                                "estudiantes_impactados": {"bsonType": "int", "minimum": 0},
                            },
                            ["plataforma", "codigo_curso", "periodo", "estudiantes_impactados"],
                        ),
                        _detalle_personalizado(),
                    ]
                },
            },
            "oneOf": [
                {"properties": {"categoria": {"enum": CATEGORIAS}}},
                {
                    "required": ["categoria_version"],
                    "properties": {
                        "categoria": {
                            "bsonType": "string",
                            "pattern": PATRON_CATEGORIA_PERSONALIZADA,
                        },
                    },
                },
            ],
        },
        # La categoría del ticket debe coincidir con la del detalle polimórfico
        "$expr": {"$eq": ["$categoria", "$detalle_especifico.categoria"]},
    }


# Kill switch apagado por defecto hasta que existan G5/G7/G8 (T17/T18/T22).
CONFIG_AGENTICA_INICIAL = {
    "modo_agentico_habilitado": False,
    "categorias_agenticas": ["infraestructura"],
    "cupo_agentico_usuario_diario": 10,
    "cupo_agentico_aula_hora": 3,
}


def esquema_configuracion_ia() -> dict:
    return {
        "$jsonSchema": {
            "bsonType": "object",
            "required": [
                "_id",
                "schema_version",
                "habilitada",
                "limite_diario_usuario",
                "limite_diario_global",
                "modo_agentico_habilitado",
                "categorias_agenticas",
                "cupo_agentico_usuario_diario",
                "cupo_agentico_aula_hora",
                "fecha_actualizacion",
            ],
            "additionalProperties": False,
            "properties": {
                "_id": {"enum": ["ia"]},
                "schema_version": {"bsonType": "int", "minimum": 1},
                "habilitada": {"bsonType": "bool"},
                "limite_diario_usuario": {"bsonType": "int", "minimum": 1, "maximum": 1000},
                "limite_diario_global": {"bsonType": "int", "minimum": 1, "maximum": 100000},
                "modo_agentico_habilitado": {"bsonType": "bool"},
                "categorias_agenticas": {
                    "bsonType": "array",
                    "maxItems": 3,
                    "uniqueItems": True,
                    "items": {"enum": ["computo_redes", "infraestructura", "academico"]},
                },
                "cupo_agentico_usuario_diario": {"bsonType": "int", "minimum": 1, "maximum": 100},
                "cupo_agentico_aula_hora": {"bsonType": "int", "minimum": 1, "maximum": 100},
                "fecha_actualizacion": {"bsonType": "date"},
            },
        }
    }


async def asegurar_coleccion(db, nombre: str, validador: dict | None = None) -> None:
    existentes = await db.list_collection_names()
    if nombre not in existentes:
        opciones = (
            {"validator": validador, "validationLevel": "strict", "validationAction": "error"} if validador else {}
        )
        await db.create_collection(nombre, **opciones)
        print(f"+ colección {nombre}")
    elif validador:
        # Antes de endurecer el validador, ningún documento existente debe quedar fuera del esquema:
        # con validationLevel=strict cualquier update posterior sobre ese documento fallaría (código 121).
        invalidos = await db[nombre].count_documents({"$nor": [validador]}, limit=1)
        if invalidos:
            raise SystemExit(
                f"! {nombre} tiene documentos que no cumplen el nuevo esquema; no se aplicó el validador. "
                "Respalda la base y ejecuta la migración (scripts/migrar_admin_t008.py) antes de reintentar."
            )
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
    await db.aulas.create_index("id_publico", unique=True, name="aulas_id_publico_unico")
    await db.aulas.create_index(
        [("edificio", ASCENDING), ("piso", ASCENDING), ("aula", ASCENDING)],
        unique=True,
        name="aulas_ubicacion_unica",
    )
    listar_colecciones = getattr(db, "list_collection_names", None)
    if not callable(listar_colecciones):
        # Algunos dobles de pruebas solo modelan las colecciones cuyos índices verifican.
        return
    colecciones = await listar_colecciones()
    if "huellas_reportes" in colecciones:
        await db.huellas_reportes.create_index(
            [("aula_id", ASCENDING), ("categoria", ASCENDING), ("fecha", DESCENDING)],
            name="huellas_aula_categoria_fecha",
        )
        await db.huellas_reportes.create_index(
            "fecha",
            expireAfterSeconds=24 * 3600,
            name="huellas_ttl_24h",
        )
        await db.huellas_reportes.create_index(
            "incidencia_id",
            unique=True,
            name="huellas_incidencia_unica",
        )
    if "coincidencias_duplicados" in colecciones:
        await db.coincidencias_duplicados.create_index(
            "expira_en",
            expireAfterSeconds=0,
            name="coincidencias_ttl",
        )
        await db.coincidencias_duplicados.create_index("huella_id", name="coincidencias_huella")
    if "adhesiones_reportes" in colecciones:
        await db.adhesiones_reportes.create_index(
            [("incidencia_id", ASCENDING), ("fecha", DESCENDING)],
            name="adhesiones_incidencia_fecha",
        )
    if "ia_eventos" in colecciones:
        eventos = db.ia_eventos
        await eventos.create_index(
            "analisis_id",
            unique=True,
            name="ia_eventos_analisis_unico",
        )
        await eventos.create_index(
            "fecha",
            expireAfterSeconds=180 * 24 * 3600,
            name="ia_eventos_ttl_180d",
        )
        await eventos.create_index(
            [("evento", ASCENDING), ("fecha", DESCENDING)],
            name="ia_eventos_evento_fecha",
        )
        await eventos.create_index(
            [("categoria", ASCENDING), ("fecha", DESCENDING)],
            name="ia_eventos_categoria_fecha",
            sparse=True,
        )
        await eventos.create_index(
            [("proveedor", ASCENDING), ("modelo", ASCENDING), ("fecha", DESCENDING)],
            name="ia_eventos_proveedor_modelo_fecha",
            sparse=True,
        )
    if "auditoria" not in colecciones:
        return
    auditoria = db.auditoria
    await auditoria.create_index(
        [("fecha", DESCENDING), ("_id", DESCENDING)],
        name="auditoria_fecha_id",
    )
    await auditoria.create_index(
        [("recurso", ASCENDING), ("fecha", DESCENDING), ("_id", DESCENDING)],
        name="auditoria_recurso_fecha_id",
    )


# Permisos que solo tiene el superadmin (rol de sistema por encima de admin).
PERMISOS_EXCLUSIVOS_SUPERADMIN = ("configuracion:gestionar", "roles:gestionar", "sistema:administrar")


def roles_sistema() -> list[dict]:
    reportante = ["incidencias:crear", "incidencias:ver", "evidencias:subir", "ia:usar"]
    tecnico = [*reportante, "seguimiento:registrar", "tags:gestionar", "incidencias:buscar"]
    coordinador = [*tecnico, "incidencias:asignar", "analitica:ver"]
    directivo = ["incidencias:ver", "incidencias:buscar", "analitica:ver"]
    # Admin opera el día a día; configuración, roles y cuentas privilegiadas quedan al superadmin.
    admin = [p for p in CATALOGO_PERMISOS if p not in PERMISOS_EXCLUSIVOS_SUPERADMIN]
    d = lambda clave, nombre, permisos, alcance: {  # noqa: E731
        "clave": clave,
        "nombre": nombre,
        "descripcion": f"Rol de sistema: {nombre}",
        "permisos": permisos,
        "alcance": alcance,
        "sistema": True,
    }
    return [
        d("reportante", "Reportante", reportante, "propio"),
        d("tecnico", "Técnico", tecnico, "area"),
        d("coordinador", "Coordinador", coordinador, "area"),
        d("directivo", "Directivo", directivo, "global"),
        d("admin", "Administrador", admin, "global"),
        d("superadmin", "Superadministrador", list(CATALOGO_PERMISOS), "global"),
    ]


def categorias_sistema() -> list[dict]:
    campo = lambda nombre, tipo, **extra: {"nombre": nombre, "tipo": tipo, **extra}  # noqa: E731
    return [
        {
            "clave": "computo_redes",
            "nombre": "Cómputo y redes",
            "prefijo": "RED",
            "area_responsable": "Tecnologías de la Información",
            "version": 1,
            "activa": True,
            "campos": [
                campo("ip", "ip", requerido=True),
                campo("vlan", "entero", requerido=True, min=1, max=4094),
                campo("puerto_uplink", "texto", requerido=True, max_length=20),
                campo("equipos_afectados", "entero", requerido=True, min=1),
            ],
        },
        {
            "clave": "infraestructura",
            "nombre": "Infraestructura",
            "prefijo": "INF",
            "area_responsable": "Servicios Generales",
            "version": 1,
            "activa": True,
            "campos": [
                campo(
                    "tipo_dano",
                    "enum",
                    requerido=True,
                    opciones=["filtracion", "electrico", "climatizacion", "cerrajeria", "luminaria", "otro"],
                ),
                campo("riesgo_seguridad", "enum", requerido=True, opciones=["bajo", "medio", "alto"]),
                campo("requiere_insumos", "booleano", requerido=True),
                campo("insumos", "lista_texto", requerido=False),
                campo("requiere_contratista", "booleano", requerido=True),
            ],
        },
        {
            "clave": "academico",
            "nombre": "Académico",
            "prefijo": "ACA",
            "area_responsable": "Servicios Escolares",
            "version": 1,
            "activa": True,
            "campos": [
                campo("plataforma", "enum", requerido=True, opciones=["lms", "portal_calificaciones", "correo"]),
                campo("codigo_curso", "texto", requerido=True, patron=r"^[A-Z]{2,4}-\d{3}$"),
                campo("periodo", "texto", requerido=True, patron=r"^\d{4}-[12]$"),
                campo("estudiantes_impactados", "entero", requerido=True, min=0),
            ],
        },
    ]


ARCHIVO_CLAVE_ADMIN_LOCAL = Path(__file__).resolve().parent.parent / ".admin-local"


ARCHIVO_CLAVE_SUPERADMIN_LOCAL = Path(__file__).resolve().parent.parent / ".superadmin-local"


def _guardar_clave_admin_local(valor: str, ruta: Path | None = None) -> Path:
    """Guarda la clave generada en un archivo ignorado por git con permisos 600, en vez de mostrarla en consola."""
    ruta = ruta or ARCHIVO_CLAVE_ADMIN_LOCAL
    descriptor = os.open(ruta, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as archivo:
        archivo.write(valor + "\n")
    os.chmod(ruta, 0o600)
    return ruta


def correo_superadmin_demo() -> str:
    return f"superadmin@{settings.dominio_correo}"


async def sembrar_superadmin_demo(db) -> dict:
    """Usuario demo con rol superadmin (solo con --seed-demo). Idempotente: si ya existe, no lo toca.

    Clave: SEED_SUPERADMIN_PASSWORD o, si no se define, una aleatoria guardada en backend/.superadmin-local (600).
    """
    correo = correo_superadmin_demo()
    existente = await db.usuarios.find_one({"correo": correo})
    if existente is not None:
        print(f"= superadmin demo {correo} ya existe")
        return existente
    local = es_uri_mongodb_local(settings.mongodb_admin_uri or settings.mongodb_uri)
    password = os.environ.get("SEED_SUPERADMIN_PASSWORD") or ""
    if not local and not password:
        raise SystemExit("Define SEED_SUPERADMIN_PASSWORD para crear el superadmin demo fuera del entorno local")
    generado = not password
    password = password or secrets.token_urlsafe(12)
    doc = {
        "schema_version": 1,
        "correo": correo,
        "nombre": "Superadministrador demo",
        "rol": "superadmin",
        "password_hash": hashear_password(password),
        "activo": True,
        "areas": [],
        "edificios": [],
        "fecha_alta": datetime.now(timezone.utc),
    }
    doc["_id"] = (await db.usuarios.insert_one(doc)).inserted_id
    print(f"+ usuario superadmin demo {correo}")
    if generado:
        ruta = _guardar_clave_admin_local(password, ARCHIVO_CLAVE_SUPERADMIN_LOCAL)
        print(f"! clave local del superadmin guardada en {ruta} (solo lectura del dueño)")
    return doc


async def sembrar_base(db) -> dict:
    for rol in roles_sistema():
        # Los roles base son parte del contrato de seguridad: se sincronizan
        # sin cambiar su _id ni las referencias de usuarios existentes.
        await db.roles.update_one({"clave": rol["clave"]}, {"$set": rol}, upsert=True)
    for cat in categorias_sistema():
        await db.categorias.update_one({"clave": cat["clave"]}, {"$setOnInsert": cat}, upsert=True)
    await db.configuracion_ia.update_one(
        {"_id": "ia"},
        {
            "$setOnInsert": {
                "schema_version": 1,
                "habilitada": settings.ia_habilitada,
                "limite_diario_usuario": settings.ia_limite_diario,
                "limite_diario_global": settings.ia_limite_global_diario,
                **CONFIG_AGENTICA_INICIAL,
                "fecha_actualizacion": datetime.now(timezone.utc),
            }
        },
        upsert=True,
    )
    # Documentos creados antes de T-034: agrega los campos agénticos que falten en una sola actualización
    # (el validador exige todos a la vez) sin tocar los valores ya configurados.
    await db.configuracion_ia.update_one(
        {"_id": "ia", "modo_agentico_habilitado": {"$exists": False}},
        [
            {
                "$set": {
                    campo: {"$ifNull": [f"${campo}", {"$literal": valor}]}
                    for campo, valor in CONFIG_AGENTICA_INICIAL.items()
                }
            }
        ],
    )
    admin = await db.usuarios.find_one({"correo": "admin@utm.local"})
    if admin is None:
        local = es_uri_mongodb_local(settings.mongodb_admin_uri or settings.mongodb_uri)
        if not local and not os.environ.get("SEED_ADMIN_PASSWORD"):
            raise SystemExit("Define SEED_ADMIN_PASSWORD para crear el admin fuera del entorno local")
        password = os.environ.get("SEED_ADMIN_PASSWORD") or secrets.token_urlsafe(12)
        generado = "SEED_ADMIN_PASSWORD" not in os.environ or not os.environ["SEED_ADMIN_PASSWORD"]
        admin = {
            "schema_version": 1,
            "correo": "admin@utm.local",
            "nombre": "Administrador",
            "rol": "admin",
            "password_hash": hashear_password(password),
            "activo": True,
            "areas": [],
            "edificios": [],
            "fecha_alta": datetime.now(timezone.utc),
        }
        res = await db.usuarios.insert_one(admin)
        admin["_id"] = res.inserted_id
        print("+ usuario admin@utm.local")
        if generado:
            ruta = _guardar_clave_admin_local(password)
            print(f"! clave local del admin guardada en {ruta} (solo lectura del dueño); bórrala tras iniciar sesión")
    return admin


EDIFICIOS = ["A", "B", "C", "Biblioteca", "Laboratorios"]
CANTIDAD_INCIDENCIAS_DEMO = 24
SEMILLA_DEMO = 42
INDICES_UBICACION_RECURRENTE = {0, 7, 14}
UBICACION_RECURRENTE = {"edificio": "A", "piso": 1, "aula": "101"}
HOSTS_MONGODB_LOCALES = {"localhost", "127.0.0.1", "::1"}


def es_uri_mongodb_local(uri: str) -> bool:
    """Indica si todos los nodos de una URI MongoDB son de la máquina local."""
    if not uri.lower().startswith("mongodb://"):
        return False
    nodos = parse_uri(uri)["nodelist"]
    return bool(nodos) and all(host.lower().rstrip(".") in HOSTS_MONGODB_LOCALES for host, _puerto in nodos)


def _detalle_demo(rnd: random.Random, categoria: str) -> dict:
    if categoria == "computo_redes":
        return {
            "categoria": categoria,
            "ip": f"10.{rnd.randint(0, 20)}.{rnd.randint(0, 250)}.{rnd.randint(2, 250)}",
            "vlan": rnd.choice([10, 20, 30, 99]),
            "puerto_uplink": f"Gi0/{rnd.randint(1, 24)}",
            "equipos_afectados": rnd.randint(1, 40),
        }
    if categoria == "infraestructura":
        return {
            "categoria": categoria,
            "tipo_dano": rnd.choice(["filtracion", "electrico", "climatizacion", "cerrajeria", "luminaria", "otro"]),
            "riesgo_seguridad": rnd.choice(["bajo", "medio", "alto"]),
            "requiere_insumos": True,
            "insumos": ["cable", "cinta aislante"],
            "requiere_contratista": rnd.random() < 0.3,
        }
    return {
        "categoria": categoria,
        "plataforma": rnd.choice(["lms", "portal_calificaciones", "correo"]),
        "codigo_curso": f"{rnd.choice(['MAT', 'FIS', 'ISC'])}-{rnd.randint(100, 499)}",
        "periodo": "2026-2",
        "estudiantes_impactados": rnd.randint(0, 120),
    }


TITULOS = {
    "computo_redes": ["Sin conexión en el laboratorio", "Switch de piso reiniciándose", "WiFi intermitente en aula"],
    "infraestructura": ["Luminaria fundida en pasillo", "Filtración en techo del aula", "Aire acondicionado no enfría"],
    "academico": [
        "Error al subir tareas al LMS",
        "Calificaciones no visibles en portal",
        "Correo institucional rechaza mensajes",
    ],
}


RUTAS_DEMO = {
    "abierta": [],
    "en_proceso": ["en_proceso"],
    "en_espera": ["en_proceso", "en_espera"],
    "resuelta": ["en_proceso", "resuelta"],
    "cerrada": ["en_proceso", "resuelta", "cerrada"],
}


def generar_documentos_demo(
    admin: dict,
    fecha_referencia: datetime | None = None,
    semilla: int = SEMILLA_DEMO,
) -> list[dict]:
    """Genera en memoria el conjunto reproducible de incidencias de demostración."""
    rnd = random.Random(semilla)
    ahora = fecha_referencia or datetime.now(timezone.utc)
    if ahora.tzinfo is None or ahora.utcoffset() is None:
        raise ValueError("fecha_referencia debe incluir zona horaria")
    ahora = ahora.astimezone(timezone.utc)
    prefijos = {"computo_redes": "RED", "infraestructura": "INF", "academico": "ACA"}
    tags_pool = [
        "red",
        "wifi",
        "switch",
        "luminaria",
        "filtracion",
        "lms",
        "calificaciones",
        "aire_acondicionado",
        "urgente",
        "laboratorio",
    ]
    docs = []
    for i in range(CANTIDAD_INCIDENCIAS_DEMO):
        categoria = CATEGORIAS[i % 3]
        estado = "resuelta" if i < 8 else ESTADOS[i % 5]  # >= 8 resueltas garantizadas
        # Fechas dentro de los últimos 30 días: el TTL de 60 días no las borra antes de la defensa.
        creada = ahora - timedelta(days=rnd.randint(5, 30), hours=rnd.randint(0, 20))
        codigo = f"INC-{creada:%Y}-{creada:%m%d}-{prefijos[categoria]}-{9000 + i}"
        historial = [
            {
                "fecha": creada,
                "usuario_id": admin["_id"],
                "estado_nuevo": "abierta",
                "comentario": "Incidencia creada",
                "horas": 0.0,
            }
        ]
        momento, total_horas = creada, 0.0
        for paso in RUTAS_DEMO[estado]:
            momento = momento + timedelta(hours=rnd.randint(2, 30))
            horas = 0.0 if paso == "cerrada" else float(rnd.randint(1, 4))
            total_horas += horas
            historial.append(
                {
                    "fecha": momento,
                    "usuario_id": admin["_id"],
                    "estado_nuevo": paso,
                    "comentario": f"Cambio a {paso} (demo)",
                    "horas": horas,
                }
            )
            if paso == "resuelta":
                fecha_resolucion = momento
        ubicacion = (
            dict(UBICACION_RECURRENTE)
            if i in INDICES_UBICACION_RECURRENTE
            else {
                "edificio": EDIFICIOS[i % len(EDIFICIOS)],
                "piso": rnd.randint(1, 3),
                "aula": f"{rnd.randint(1, 3)}0{rnd.randint(1, 9)}",
            }
        )
        doc = {
            "schema_version": 1,
            "demo": True,
            "codigo": codigo,
            "titulo": rnd.choice(TITULOS[categoria]),
            "descripcion": "Incidencia sintética generada para demostración del sistema UTM Desk.",
            "categoria": categoria,
            "estado": estado,
            "prioridad": PRIORIDADES[i % 4],
            "ubicacion": ubicacion,
            "reportante": {"usuario_id": admin["_id"], "nombre": admin["nombre"]},
            "detalle_especifico": _detalle_demo(rnd, categoria),
            "tags": rnd.sample(tags_pool, rnd.randint(2, 4)),
            "evidencias_adjuntas": [],
            "horas_invertidas": total_horas,
            "historial_seguimiento": historial,
            "fecha_creacion": creada,
            "fecha_actualizacion": momento,
        }
        if estado in ("resuelta", "cerrada"):
            doc["fecha_resolucion"] = fecha_resolucion
        if i < 18:  # >= 15 con evidencias
            evidencia_id = str(uuid.UUID(int=rnd.getrandbits(128), version=4))
            doc["evidencias_adjuntas"] = [
                {
                    "evidencia_id": evidencia_id,
                    "nombre_archivo": f"evidencia_{i}.jpg",
                    "tipo_mime": "image/jpeg",
                    "peso_kb": rnd.randint(200, 1500),
                    "url_storage": f"evidencias/{codigo}/{evidencia_id}.jpg",
                    "fecha_carga": creada,
                    "subido_por": admin["_id"],
                }
            ]
        docs.append(doc)
    return docs


async def sembrar_demo(db, admin: dict, reiniciar: bool = False) -> None:
    existentes = await db.incidencias_campus.count_documents({"demo": True})
    if reiniciar:
        borradas = (await db.incidencias_campus.delete_many({"demo": True})).deleted_count
        print(f"- {borradas} incidencias demo eliminadas")
    elif existentes:
        if existentes == CANTIDAD_INCIDENCIAS_DEMO:
            print("= demo ya sembrado (usa --reset-demo para regenerarlo)")
        else:
            print(
                f"! demo parcial detectado: {existentes}/{CANTIDAD_INCIDENCIAS_DEMO}; "
                "usa --reset-demo únicamente en un entorno local autorizado"
            )
        return
    docs = generar_documentos_demo(admin)
    await db.incidencias_campus.insert_many(docs)
    print(f"+ {len(docs)} incidencias demo")


async def main() -> None:
    uri = settings.mongodb_admin_uri or settings.mongodb_uri
    if "--reset-demo" in sys.argv and not es_uri_mongodb_local(uri):
        raise SystemExit("--reset-demo solo está permitido con MongoDB local")
    cliente = AsyncMongoClient(uri)
    db = cliente[settings.mongodb_db]
    try:
        await asegurar_coleccion(db, "incidencias_campus", esquema_incidencias())
        for nombre, validador in (
            ("usuarios", esquema_usuarios()),
            ("roles", esquema_roles()),
            ("categorias", esquema_categorias()),
            ("auditoria", esquema_auditoria()),
            ("aulas", esquema_aulas()),
            ("huellas_reportes", esquema_huellas_reportes()),
            ("coincidencias_duplicados", esquema_coincidencias_duplicados()),
            ("adhesiones_reportes", esquema_adhesiones_reportes()),
            ("ia_eventos", esquema_ia_eventos()),
            ("configuracion_ia", esquema_configuracion_ia()),
        ):
            await asegurar_coleccion(db, nombre, validador)
        await crear_indices(db)
        admin = await sembrar_base(db)
        if "--seed-demo" in sys.argv or "--reset-demo" in sys.argv:
            await sembrar_demo(db, admin, reiniciar="--reset-demo" in sys.argv)
            await sembrar_superadmin_demo(db)
        print("OK: base de datos lista")
    finally:
        await cliente.close()


if __name__ == "__main__":
    asyncio.run(main())
