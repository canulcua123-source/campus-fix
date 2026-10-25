"""Genera los artefactos reproducibles y seguros de la entrega T-013.

El modo predeterminado no abre conexiones: carga las definiciones canónicas de
``init_db.py`` en un entorno aislado y produce Extended JSON en memoria.
"""

import argparse
import asyncio
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any

from bson import ObjectId, json_util
from pymongo.uri_parser import parse_uri


RAIZ_PROYECTO = Path(__file__).resolve().parents[2]
DIRECTORIO_ENTREGA = RAIZ_PROYECTO / "entrega"
RUTA_SCRIPT_MAESTRO = DIRECTORIO_ENTREGA / "script_maestro.js"
RUTA_JSON = DIRECTORIO_ENTREGA / "incidencias_campus.json"
RUTA_INIT_DB = Path(__file__).with_name("init_db.py")
BASE_ENTREGA = "utm_desk_entrega"
COLECCION_INCIDENCIAS = "incidencias_campus"
USUARIO_SINTETICO_ID = ObjectId("64f000000000000000000013")
PREFIJO_ID_INCIDENCIA = "65000000000000000000"
TERMINOS_SENSIBLES_JSON = (
    "password_hash",
    "password",
    "refresh_token",
    "access_token",
    "jwt",
    "secret",
    "mongodb://",
    "mongodb+srv://",
)
OPCIONES_EJSON = json_util.CANONICAL_JSON_OPTIONS.with_options(
    tz_aware=True,
    tzinfo=timezone.utc,
)


@dataclass(frozen=True)
class DefinicionIndice:
    coleccion: str
    claves: list[tuple[str, Any]]
    opciones: dict[str, Any]


@dataclass(frozen=True)
class ContextoEntrega:
    fecha_referencia: datetime
    esquemas: dict[str, dict[str, Any]]
    indices: list[DefinicionIndice]
    roles: list[dict[str, Any]]
    categorias: list[dict[str, Any]]
    usuario: dict[str, Any]
    incidencias: list[dict[str, Any]]


class _ColeccionCapturadora:
    def __init__(self, nombre: str, registros: list[DefinicionIndice]) -> None:
        self.nombre = nombre
        self.registros = registros

    async def create_index(self, claves: Any, **opciones: Any) -> str:
        claves_normalizadas = [(claves, 1)] if isinstance(claves, str) else list(claves)
        self.registros.append(DefinicionIndice(self.nombre, claves_normalizadas, dict(opciones)))
        return opciones.get("name", "indice_generado")


class _BaseCapturadora:
    def __init__(self) -> None:
        self.registros: list[DefinicionIndice] = []
        self._colecciones: dict[str, _ColeccionCapturadora] = {}

    def __getattr__(self, nombre: str) -> _ColeccionCapturadora:
        if nombre.startswith("_"):
            raise AttributeError(nombre)
        return self._colecciones.setdefault(nombre, _ColeccionCapturadora(nombre, self.registros))


def _cargar_fuente_canonica() -> ModuleType:
    """Carga init_db.py sin importar la configuración ni leer un archivo .env."""
    nombre_modulo = "_t013_fuente_init_db"
    especificacion = importlib.util.spec_from_file_location(nombre_modulo, RUTA_INIT_DB)
    if especificacion is None or especificacion.loader is None:
        raise RuntimeError(f"No fue posible cargar la fuente canónica: {RUTA_INIT_DB}")

    configuracion_falsa = ModuleType("app.core.config")
    configuracion_falsa.settings = SimpleNamespace(
        mongodb_admin_uri="",
        mongodb_uri="mongodb://127.0.0.1:27017",
        mongodb_db=BASE_ENTREGA,
    )
    seguridad_falsa = ModuleType("app.core.security")
    seguridad_falsa.hashear_password = lambda _valor: "fixture-no-utilizable"
    sustituciones = {
        "app.core.config": configuracion_falsa,
        "app.core.security": seguridad_falsa,
    }
    anteriores = {nombre: sys.modules.get(nombre) for nombre in sustituciones}
    try:
        sys.modules.update(sustituciones)
        modulo = importlib.util.module_from_spec(especificacion)
        especificacion.loader.exec_module(modulo)
    finally:
        for nombre, anterior in anteriores.items():
            if anterior is None:
                sys.modules.pop(nombre, None)
            else:
                sys.modules[nombre] = anterior
    return modulo


def _capturar_indices(modulo: ModuleType) -> list[DefinicionIndice]:
    base = _BaseCapturadora()
    asyncio.run(modulo.crear_indices(base))
    return base.registros


def _fecha_referencia_predeterminada() -> datetime:
    ahora = datetime.now(timezone.utc)
    return ahora.replace(hour=12, minute=0, second=0, microsecond=0)


def interpretar_fecha_referencia(valor: str | None) -> datetime:
    if valor is None:
        return _fecha_referencia_predeterminada()
    normalizado = valor.strip().replace("Z", "+00:00")
    try:
        fecha = datetime.fromisoformat(normalizado)
    except ValueError as exc:
        raise ValueError("--fecha-referencia debe usar ISO 8601, por ejemplo 2026-10-24T12:00:00+00:00") from exc
    if fecha.tzinfo is None or fecha.utcoffset() is None:
        raise ValueError("--fecha-referencia debe incluir zona horaria")
    return fecha.astimezone(timezone.utc).replace(microsecond=0)


def construir_contexto(fecha_referencia: datetime) -> ContextoEntrega:
    modulo = _cargar_fuente_canonica()
    usuario = {
        "_id": USUARIO_SINTETICO_ID,
        "schema_version": 1,
        "correo": "usuario.t013@ejemplo.invalid",
        "nombre": "Usuario Sintético T-013",
        # Marcador deliberadamente inválido: satisface el tipo BSON sin ser una credencial utilizable.
        "password_hash": "FIXTURE_NO_UTILIZABLE_T013",
        "rol": "admin",
        "activo": False,
        "areas": list(modulo.CATEGORIAS),
        "edificios": list(modulo.EDIFICIOS),
        "tipo_reportante": "administrativo",
        "fecha_alta": fecha_referencia,
    }
    incidencias = modulo.generar_documentos_demo(usuario, fecha_referencia=fecha_referencia)
    for indice, incidencia in enumerate(incidencias):
        incidencia["_id"] = ObjectId(f"{PREFIJO_ID_INCIDENCIA}{indice:04x}")

    return ContextoEntrega(
        fecha_referencia=fecha_referencia,
        esquemas={
            "incidencias_campus": modulo.esquema_incidencias(),
            "usuarios": modulo.esquema_usuarios(),
            "roles": modulo.esquema_roles(),
            "categorias": modulo.esquema_categorias(),
            "aulas": modulo.esquema_aulas(),
        },
        indices=_capturar_indices(modulo),
        roles=modulo.roles_sistema(),
        categorias=modulo.categorias_sistema(),
        usuario=usuario,
        incidencias=incidencias,
    )


def _ejson(valor: Any, *, sangria: int | None = None) -> str:
    return json_util.dumps(
        valor,
        json_options=OPCIONES_EJSON,
        ensure_ascii=False,
        indent=sangria,
    )


def _expresion_ejson(valor: Any) -> str:
    return f"EJSON.parse({json.dumps(_ejson(valor), ensure_ascii=False)})"


def _indice_a_documento(indice: DefinicionIndice) -> dict[str, Any]:
    return {
        "coleccion": indice.coleccion,
        "claves": [[campo, direccion] for campo, direccion in indice.claves],
        "opciones": indice.opciones,
    }


def construir_script_maestro(contexto: ContextoEntrega) -> str:
    abiertas = [doc for doc in contexto.incidencias if doc["estado"] == "abierta"]
    if not abiertas:
        raise ValueError("El generador canónico no produjo una incidencia abierta para la demostración")
    objetivo = abiertas[0]
    prioridad_original = objetivo["prioridad"]
    prioridad_temporal = "media" if prioridad_original != "media" else "baja"
    filtro_objetivo = {
        "_id": objetivo["_id"],
        "codigo": objetivo["codigo"],
        "demo": True,
        "estado": "abierta",
    }
    termino_busqueda = objetivo["titulo"]
    definiciones_indices = [_indice_a_documento(indice) for indice in contexto.indices]
    fecha_iso = contexto.fecha_referencia.isoformat().replace("+00:00", "Z")

    return f'''// UTM Desk — Script maestro de entrega Fase 2
// Archivo generado automáticamente.
// Fuente oficial de esquemas e índices: backend/scripts/init_db.py
// Fuente oficial de datos demo: generador T-009.
// Uso permitido: base MongoDB local, vacía y aislada.
// NO ejecutar sobre producción ni sobre una base con datos existentes.
// Fecha de referencia reproducible: {fecha_iso}

"use strict";

const BASE_ESPERADA = "{BASE_ENTREGA}";
const COLECCIONES_ESPERADAS = ["incidencias_campus", "usuarios", "roles", "categorias", "aulas"];

function exigir(condicion, mensaje) {{
  if (!condicion) {{
    throw new Error(mensaje);
  }}
}}

function conexionEsLoopback(uri) {{
  if (typeof uri !== "string" || !uri.startsWith("mongodb://")) return false;
  const autoridad = uri.slice("mongodb://".length).split("/")[0].split("@").pop();
  if (!autoridad) return false;
  return autoridad.split(",").every((nodo) => {{
    const host = nodo.trim().toLowerCase();
    return host === "localhost" || host.startsWith("localhost:") ||
      host === "127.0.0.1" || host.startsWith("127.0.0.1:") ||
      host === "[::1]" || host.startsWith("[::1]:");
  }});
}}

const uriActual = db.getMongo().getURI();
exigir(conexionEsLoopback(uriActual), "T-013 solo admite una conexión loopback explícita.");
exigir(db.getName() === BASE_ESPERADA, `Base no autorizada: se exige ${{BASE_ESPERADA}}.`);
exigir(db.getCollectionNames().length === 0, "La base de entrega debe estar completamente vacía.");

const VALIDADORES = {_expresion_ejson(contexto.esquemas)};
for (const nombre of COLECCIONES_ESPERADAS) {{
  db.createCollection(nombre, {{
    validator: VALIDADORES[nombre],
    validationLevel: "strict",
    validationAction: "error",
  }});
}}

const DEFINICIONES_INDICES = {_expresion_ejson(definiciones_indices)};
for (const definicion of DEFINICIONES_INDICES) {{
  const claves = Object.fromEntries(definicion.claves);
  db.getCollection(definicion.coleccion).createIndex(claves, definicion.opciones);
}}

const ROLES_SISTEMA = {_expresion_ejson(contexto.roles)};
const CATEGORIAS_SISTEMA = {_expresion_ejson(contexto.categorias)};
const USUARIO_SINTETICO = {_expresion_ejson(contexto.usuario)};
const INCIDENCIAS_DEMO = {_expresion_ejson(contexto.incidencias)};

db.roles.insertMany(ROLES_SISTEMA);
db.categorias.insertMany(CATEGORIAS_SISTEMA);
db.usuarios.insertOne(USUARIO_SINTETICO);
db.incidencias_campus.insertMany(INCIDENCIAS_DEMO);

exigir(Number(db.incidencias_campus.countDocuments({{ demo: true }})) === 24,
  "La carga debe contener exactamente 24 incidencias demo.");

const filtroDemoExacto = {_expresion_ejson(filtro_objetivo)};
function exigirActualizacion(resultado, operador) {{
  exigir(Number(resultado.matchedCount) === 1, `${{operador}} no encontró exactamente el documento demo esperado.`);
  exigir(Number(resultado.modifiedCount) === 1, `${{operador}} no realizó el cambio reversible esperado.`);
}}

// $set modifica temporalmente una prioridad permitida. updateOne es atómico sobre un único
// documento, el filtro combina _id/código/demo/estado, se espera un cambio y después se restaura.
exigirActualizacion(
  db.incidencias_campus.updateOne(filtroDemoExacto, {{ $set: {{ prioridad: {json.dumps(prioridad_temporal)} }} }}),
  "$set",
);
exigirActualizacion(
  db.incidencias_campus.updateOne(
    {{ ...filtroDemoExacto, prioridad: {json.dumps(prioridad_temporal)} }},
    {{ $set: {{ prioridad: {json.dumps(prioridad_original)} }} }},
  ),
  "$set (restauración)",
);

// $inc suma 0.25 horas sin leer-modificar-escribir. El filtro exacto limita el cambio,
// el resultado esperado es una modificación y una segunda operación revierte el valor original.
exigirActualizacion(
  db.incidencias_campus.updateOne(filtroDemoExacto, {{ $inc: {{ horas_invertidas: 0.25 }} }}),
  "$inc",
);
exigirActualizacion(
  db.incidencias_campus.updateOne(filtroDemoExacto, {{ $inc: {{ horas_invertidas: -0.25 }} }}),
  "$inc (restauración)",
);

// $push agrega una etiqueta temporal y limita tags a 15 con $slice. La actualización de
// un documento es atómica, usa el filtro demo exacto y la etiqueta se retira al final.
exigirActualizacion(
  db.incidencias_campus.updateOne(
    filtroDemoExacto,
    {{ $push: {{ tags: {{ $each: ["demo_push_t013"], $slice: -15 }} }} }},
  ),
  "$push",
);

// $addToSet incorpora una segunda etiqueta solo si no existe. Es atómico, está acotado al
// mismo documento sintético, se espera un cambio único y no puede crear duplicados.
exigirActualizacion(
  db.incidencias_campus.updateOne(
    filtroDemoExacto,
    {{ $addToSet: {{ tags: {{ $each: ["demo_set_t013"] }} }} }},
  ),
  "$addToSet",
);

// $pull retira únicamente las dos etiquetas temporales. La operación es atómica, conserva
// las etiquetas originales y deja las 24 incidencias en el mismo estado lógico de entrada.
exigirActualizacion(
  db.incidencias_campus.updateOne(
    filtroDemoExacto,
    {{ $pull: {{ tags: {{ $in: ["demo_push_t013", "demo_set_t013"] }} }} }},
  ),
  "$pull",
);

const incidenciaRestaurada = db.incidencias_campus.findOne(filtroDemoExacto);
exigir(incidenciaRestaurada.prioridad === {json.dumps(prioridad_original)}, "No se restauró la prioridad original.");
exigir(Math.abs(Number(incidenciaRestaurada.horas_invertidas) - {float(objetivo['horas_invertidas'])}) < 1e-9,
  "No se restauraron las horas originales.");
exigir(!incidenciaRestaurada.tags.includes("demo_push_t013") &&
  !incidenciaRestaurada.tags.includes("demo_set_t013"), "Quedaron etiquetas temporales.");

// BÚSQUEDA DE TEXTO — usa el índice titulo/descripcion y ordena por textScore.
const resultadosTexto = db.incidencias_campus.find(
  {{ demo: true, $text: {{ $search: {json.dumps(termino_busqueda, ensure_ascii=False)} }} }},
  {{ _id: 0, codigo: 1, titulo: 1, score: {{ $meta: "textScore" }} }},
).sort({{ score: {{ $meta: "textScore" }} }}).limit(5).toArray();
print("=== BÚSQUEDA $text CON textScore ===");
printjson(resultadosTexto);

// PIPELINE 1 — EFICIENCIA POR EDIFICIO
// Filtra solo la demo resuelta/cerrada, calcula horas reales, agrupa con $sum/$avg y ordena el promedio.
const pipelineEdificios = [
  {{ $match: {{ $and: [
    {{ demo: true }},
    {{ estado: {{ $in: ["resuelta", "cerrada"] }} }},
    {{ fecha_resolucion: {{ $type: "date" }} }},
  ] }} }},
  {{ $project: {{
    edificio: "$ubicacion.edificio",
    horas_invertidas: 1,
    horas_resolucion: {{ $divide: [{{ $subtract: ["$fecha_resolucion", "$fecha_creacion"] }}, 3600000] }},
  }} }},
  {{ $group: {{
    _id: "$edificio",
    total: {{ $sum: 1 }},
    horas_invertidas: {{ $sum: "$horas_invertidas" }},
    horas_resolucion_prom: {{ $avg: "$horas_resolucion" }},
  }} }},
  {{ $sort: {{ horas_resolucion_prom: -1 }} }},
  {{ $project: {{
    _id: 0,
    edificio: "$_id",
    total: 1,
    horas_invertidas: 1,
    horas_resolucion_prom: {{ $round: ["$horas_resolucion_prom", 1] }},
  }} }},
];
print("=== PIPELINE 1 — EFICIENCIA POR EDIFICIO ===");
printjson(db.incidencias_campus.aggregate(pipelineEdificios).toArray());

// PIPELINE 2 — TOP 10 ETIQUETAS
// Filtra la demo, despliega tags, cuenta con $sum, ordena por frecuencia y desempata alfabéticamente.
const pipelineTags = [
  {{ $match: {{ demo: true }} }},
  {{ $unwind: "$tags" }},
  {{ $group: {{ _id: "$tags", total: {{ $sum: 1 }} }} }},
  {{ $sort: {{ total: -1, _id: 1 }} }},
  {{ $limit: 10 }},
  {{ $project: {{ _id: 0, tag: "$_id", total: 1 }} }},
];
print("=== PIPELINE 2 — TOP 10 ETIQUETAS ===");
printjson(db.incidencias_campus.aggregate(pipelineTags).toArray());

print("=== RESUMEN T-013 ===");
printjson({{
  base: db.getName(),
  colecciones: db.getCollectionNames().sort(),
  incidencias_demo: db.incidencias_campus.countDocuments({{ demo: true }}),
  fecha_referencia: {json.dumps(fecha_iso)},
  usuario_fixture: USUARIO_SINTETICO.correo,
}});
'''


def construir_json_incidencias(contexto: ContextoEntrega) -> str:
    return _ejson(contexto.incidencias, sangria=2) + "\n"


def _contiene_nulo(valor: Any) -> bool:
    if valor is None:
        return True
    if isinstance(valor, dict):
        return any(_contiene_nulo(elemento) for elemento in valor.values())
    if isinstance(valor, list):
        return any(_contiene_nulo(elemento) for elemento in valor)
    return False


def validar_documentos(documentos: Any) -> list[dict[str, Any]]:
    if not isinstance(documentos, list):
        raise ValueError("El JSON de entrega debe ser un arreglo")
    if len(documentos) != 24:
        raise ValueError("El JSON de entrega debe contener exactamente 24 incidencias")
    if Counter(doc.get("categoria") for doc in documentos if isinstance(doc, dict)) != {
        "computo_redes": 8,
        "infraestructura": 8,
        "academico": 8,
    }:
        raise ValueError("Las tres categorías deben conservar la distribución 8/8/8")
    if any(not isinstance(doc, dict) or doc.get("demo") is not True for doc in documentos):
        raise ValueError("Todos los documentos exportados deben ser incidencias demo")
    if any(_contiene_nulo(doc) for doc in documentos):
        raise ValueError("El JSON de entrega no admite valores null")
    if any(not isinstance(doc.get("_id"), ObjectId) for doc in documentos):
        raise ValueError("Cada incidencia debe conservar un _id BSON ObjectId")
    if len({doc["codigo"] for doc in documentos}) != 24:
        raise ValueError("Los códigos de incidencia deben ser únicos")
    if any(doc["reportante"]["usuario_id"] != USUARIO_SINTETICO_ID for doc in documentos):
        raise ValueError("Las referencias deben apuntar al usuario sintético T-013")

    from scripts.verificar_demo import verificar_requisitos

    resultados = verificar_requisitos(documentos)
    fallos = [f"{resultado.clave}: {resultado.detalle}" for resultado in resultados if not resultado.cumple]
    if len(resultados) != 17 or fallos:
        raise ValueError("El verificador T-009 rechazó el dataset: " + "; ".join(fallos))
    return documentos


def validar_json_entrega(contenido: str) -> list[dict[str, Any]]:
    texto_minusculas = contenido.lower()
    presentes = [termino for termino in TERMINOS_SENSIBLES_JSON if termino in texto_minusculas]
    if presentes:
        raise ValueError(f"El JSON contiene términos sensibles prohibidos: {', '.join(presentes)}")
    if "@" in contenido:
        raise ValueError("El JSON no debe contener direcciones de correo")
    try:
        documentos = json_util.loads(contenido, json_options=OPCIONES_EJSON)
    except (TypeError, ValueError) as exc:
        raise ValueError("El archivo de incidencias no es Extended JSON válido") from exc
    return validar_documentos(documentos)


def validar_script_maestro(contenido: str, contexto: ContextoEntrega) -> None:
    obligatorios = (
        "$set",
        "$inc",
        "$push",
        "$addToSet",
        "$pull",
        "$text",
        '"textScore"',
        "PIPELINE 1 — EFICIENCIA POR EDIFICIO",
        "PIPELINE 2 — TOP 10 ETIQUETAS",
        'validationLevel: "strict"',
        'validationAction: "error"',
        "countDocuments({ demo: true })",
    )
    faltantes = [elemento for elemento in obligatorios if elemento not in contenido]
    if faltantes:
        raise ValueError(f"El script maestro carece de elementos obligatorios: {', '.join(faltantes)}")
    prohibidos = ("dropDatabase", "dropCollection", "deleteMany", "deleteOne", "mongodb+srv://")
    encontrados = [elemento for elemento in prohibidos if elemento in contenido]
    if encontrados:
        raise ValueError(f"El script maestro contiene operaciones o destinos prohibidos: {', '.join(encontrados)}")
    if _expresion_ejson(contexto.esquemas) not in contenido:
        raise ValueError("Los validadores del script no coinciden con init_db.py")
    indices = [_indice_a_documento(indice) for indice in contexto.indices]
    if _expresion_ejson(indices) not in contenido:
        raise ValueError("Los índices del script no coinciden con crear_indices()")


def validar_uri_exportacion_local(uri: str) -> None:
    if not uri.lower().startswith("mongodb://"):
        raise ValueError("La exportación solo admite mongodb:// con un host loopback explícito")
    try:
        informacion = parse_uri(uri)
    except Exception as exc:
        raise ValueError("La URI local de exportación no es válida") from exc
    nodos = informacion.get("nodelist") or []
    hosts_permitidos = {"localhost", "127.0.0.1", "::1"}
    if not nodos or any(host.lower().rstrip(".") not in hosts_permitidos for host, _puerto in nodos):
        raise ValueError("La exportación rechaza Atlas y cualquier host que no sea loopback")
    if informacion.get("database") != BASE_ENTREGA:
        raise ValueError(f"La URI debe seleccionar exclusivamente la base {BASE_ENTREGA}")
    if informacion.get("username") or informacion.get("password"):
        raise ValueError("No incluyas credenciales en la URI del entregable")


def _escribir_atomico(ruta: Path, contenido: str) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    descriptor, nombre_temporal = tempfile.mkstemp(prefix=f".{ruta.name}.", suffix=".tmp", dir=ruta.parent)
    temporal = Path(nombre_temporal)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as archivo:
            archivo.write(contenido)
            archivo.flush()
            os.fsync(archivo.fileno())
        os.replace(temporal, ruta)
    finally:
        temporal.unlink(missing_ok=True)


def _exportar_desde_mongodb_local(uri: str) -> str:
    validar_uri_exportacion_local(uri)
    ruta_ejecutable = shutil.which("mongoexport")
    if ruta_ejecutable is None:
        raise RuntimeError("No se encontró mongoexport; instala MongoDB Database Tools manualmente")

    DIRECTORIO_ENTREGA.mkdir(parents=True, exist_ok=True)
    descriptor, nombre_temporal = tempfile.mkstemp(
        prefix=".incidencias_campus.",
        suffix=".json",
        dir=DIRECTORIO_ENTREGA,
    )
    os.close(descriptor)
    temporal = Path(nombre_temporal)
    try:
        comando = [
            ruta_ejecutable,
            "--uri",
            uri,
            "--db",
            BASE_ENTREGA,
            "--collection",
            COLECCION_INCIDENCIAS,
            "--query",
            '{"demo":true}',
            "--jsonArray",
            "--jsonFormat=canonical",
            "--out",
            str(temporal),
        ]
        # El ejecutable tiene nombre fijo, se resuelve a una ruta y cada argumento viaja separado.
        subprocess.run(comando, check=True, capture_output=True, text=True)  # noqa: S603
        contenido = temporal.read_text(encoding="utf-8")
        validar_json_entrega(contenido)
        return contenido if contenido.endswith("\n") else contenido + "\n"
    except subprocess.CalledProcessError as exc:
        detalle = (exc.stderr or exc.stdout or "error sin detalle").strip()
        raise RuntimeError(f"mongoexport local falló: {detalle}") from exc
    finally:
        temporal.unlink(missing_ok=True)


def generar_entrega(
    fecha_referencia: datetime,
    *,
    modo: str = "sin-conexion",
    uri_local: str | None = None,
    ruta_script: Path = RUTA_SCRIPT_MAESTRO,
    ruta_json: Path = RUTA_JSON,
) -> tuple[Path, Path]:
    contexto = construir_contexto(fecha_referencia)
    script = construir_script_maestro(contexto)
    validar_script_maestro(script, contexto)

    if modo == "sin-conexion":
        json_entrega = construir_json_incidencias(contexto)
        validar_json_entrega(json_entrega)
    elif modo == "exportacion-local":
        if uri_local is None:
            raise ValueError("--uri-local es obligatorio en el modo exportacion-local")
        json_entrega = _exportar_desde_mongodb_local(uri_local)
        documentos_exportados = validar_json_entrega(json_entrega)

        def ordenar_por_id(documento: dict[str, Any]) -> str:
            return str(documento["_id"])

        if sorted(documentos_exportados, key=ordenar_por_id) != sorted(contexto.incidencias, key=ordenar_por_id):
            raise ValueError(
                "La base local no coincide con la fecha de referencia y el generador canónico; "
                "no se publicaron artefactos mezclados"
            )
    else:
        raise ValueError(f"Modo de generación desconocido: {modo}")

    _escribir_atomico(ruta_script, script)
    _escribir_atomico(ruta_json, json_entrega)
    return ruta_script, ruta_json


def _crear_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Genera los artefactos seguros de T-013")
    parser.add_argument(
        "--fecha-referencia",
        help="Fecha/hora ISO 8601 UTC; por defecto usa las 12:00 UTC del día actual",
    )
    parser.add_argument(
        "--modo",
        choices=("sin-conexion", "exportacion-local"),
        default="sin-conexion",
        help="Origen del JSON; sin-conexion no abre sockets",
    )
    parser.add_argument("--uri-local", help=f"URI loopback explícita terminada en /{BASE_ENTREGA}")
    return parser


def main() -> int:
    argumentos = _crear_parser().parse_args()
    try:
        fecha = interpretar_fecha_referencia(argumentos.fecha_referencia)
        rutas = generar_entrega(
            fecha,
            modo=argumentos.modo,
            uri_local=argumentos.uri_local,
        )
    except (OSError, RuntimeError, ValueError) as exc:
        print(f"ERROR T-013: {exc}", file=sys.stderr)
        return 1

    origen = "memoria (sin conexión)" if argumentos.modo == "sin-conexion" else "mongoexport local"
    print(f"OK: {rutas[0].relative_to(RAIZ_PROYECTO)}")
    print(f"OK: {rutas[1].relative_to(RAIZ_PROYECTO)}")
    print(f"Origen de incidencias_campus.json: {origen}")
    print(f"Fecha de referencia UTC: {fecha.isoformat()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
