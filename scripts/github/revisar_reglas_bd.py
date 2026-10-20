#!/usr/bin/env python3
"""Revisa el diff de un PR buscando patrones peligrosos de base de datos y seguridad.

Solo mira LÍNEAS AGREGADAS en backend/app, backend/scripts y scripts/ (excepto scripts/github).
Las pruebas (backend/tests) no se revisan: ahí se permite limpiar la BD local `utm_desk_test`.

Uso:
    python3 scripts/github/revisar_reglas_bd.py                    # compara contra origin/dev
    python3 scripts/github/revisar_reglas_bd.py --base origin/main

Excepción justificada (la verá quien revise el PR): agrega al final de la línea
    # reglas-bd: permitido <motivo>
Salida: 0 = sin errores (puede haber avisos), 1 = hay errores, 2 = error de uso/git.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from dataclasses import dataclass

RUTAS = ["backend/app", "backend/scripts", "scripts"]
EXCLUIR = ("scripts/github/",)
INIT_DB = "backend/scripts/init_db.py"
MARCA_PERMITIDO = re.compile(r"#\s*reglas-bd:\s*permitido\s+\S")

# (id, regex, mensaje, aplica_a(ruta) -> bool)
REGLAS: list[tuple[str, re.Pattern[str], str, object]] = [
    ("drop_database", re.compile(r"\bdrop_database\b"),
     "Prohibido borrar la base de datos (drop_database).", None),
    ("drop", re.compile(r"\.drop\s*\(|\bdrop_collection\b"),
     "Prohibido borrar colecciones (.drop / drop_collection). Pide el cambio en un issue de BD.", None),
    ("delete_many_vacio", re.compile(r"delete_many\s*\(\s*\{\s*\}"),
     "delete_many({}) borra TODA la colección. Usa un filtro explícito y acotado.", None),
    ("collMod", re.compile(r"collMod"),
     f"collMod (cambio de validador/esquema) solo se permite en {INIT_DB}.",
     lambda ruta: ruta != INIT_DB),
    ("where", re.compile(r"\$where"),
     "$where ejecuta JavaScript en el servidor de Mongo: prohibido.", None),
    ("uri_con_credenciales", re.compile(r"mongodb(\+srv)?://[^/\s:@\"']+:[^@\s\"']+@"),
     "URI de Mongo con usuario:contraseña en el código. Los secretos van solo en .env.", None),
    ("cors_abierto", re.compile(r"allow_origins\s*=\s*\[\s*[\"']\*[\"']\s*\]"),
     "allow_origins=['*'] abre la API a cualquier sitio. Usa settings.cors_lista.", None),
    ("print_secreto", re.compile(r"\bprint\s*\(.*(password|passwd|contrase|secret|token|api_key)", re.I),
     "No imprimas contraseñas, tokens ni secretos (ni en scripts).", None),
    ("verify_false", re.compile(r"\bverify\s*=\s*False\b"),
     "verify=False desactiva la verificación TLS: prohibido.", None),
    ("except_pass", re.compile(r"except\s*(Exception\s*)?(as\s+\w+\s*)?:\s*pass\b"),
     "`except Exception: pass` oculta errores. Maneja el error o regístralo.", None),
]

AVISOS: list[tuple[str, re.Pattern[str], str]] = [
    ("regex_usuario", re.compile(r"\$regex"),
     "$regex: si el patrón viene del usuario usa re.escape() y limita la longitud (o usa $text)."),
    ("null", re.compile(r"[\"']\$set[\"']\s*:\s*\{[^}]*:\s*None\b"),
     "No guardes null en Mongo: omite el campo o usa $unset."),
]

OPERACION_INCIDENCIAS = re.compile(
    r"incidencias_campus\s*\.\s*(find|find_one|find_one_and_update|update_one|update_many|"
    r"count_documents|aggregate|delete_one|replace_one)\b"
)
EXCEPT_SOLO = re.compile(r"^\s*except\s*(Exception\s*)?(as\s+\w+\s*)?:\s*(#.*)?$")
PASS_SOLO = re.compile(r"^\s*pass\s*(#.*)?$")


@dataclass
class Hallazgo:
    nivel: str  # "error" | "warning"
    ruta: str
    linea: int
    regla: str
    mensaje: str
    codigo: str


def git(*args: str) -> str:
    r = subprocess.run(["git", *args], capture_output=True, text=True)
    if r.returncode != 0:
        print(f"Error ejecutando git {' '.join(args)}:\n{r.stderr}", file=sys.stderr)
        sys.exit(2)
    return r.stdout


def lineas_agregadas(base: str) -> dict[str, list[tuple[int, str]]]:
    diff = git("diff", "--unified=0", "--no-color", "--no-ext-diff", f"{base}...HEAD", "--", *RUTAS)
    por_archivo: dict[str, list[tuple[int, str]]] = {}
    ruta = None
    num = 0
    for linea in diff.splitlines():
        if linea.startswith("+++ "):
            destino = linea[4:]
            ruta = None if destino == "/dev/null" else destino.removeprefix("b/")
            if ruta and (ruta.startswith(EXCLUIR) or not ruta.endswith(".py")):
                ruta = None
            continue
        m = re.match(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@", linea)
        if m:
            num = int(m.group(1))
            continue
        if ruta is None:
            continue
        if linea.startswith("+"):
            por_archivo.setdefault(ruta, []).append((num, linea[1:]))
            num += 1
    return por_archivo


def revisar(base: str) -> list[Hallazgo]:
    hallazgos: list[Hallazgo] = []
    for ruta, lineas in lineas_agregadas(base).items():
        anterior: tuple[int, str] | None = None
        for num, codigo in lineas:
            permitido = bool(MARCA_PERMITIDO.search(codigo))
            for regla, patron, mensaje, aplica in REGLAS:
                if patron.search(codigo) and (aplica is None or aplica(ruta)):
                    nivel = "warning" if permitido else "error"
                    extra = " (marcado como permitido: el revisor debe validar el motivo)" if permitido else ""
                    hallazgos.append(Hallazgo(nivel, ruta, num, regla, mensaje + extra, codigo.strip()))
            # `except Exception:` en una línea y `pass` en la siguiente
            if anterior and anterior[0] == num - 1 and EXCEPT_SOLO.match(anterior[1]) and PASS_SOLO.match(codigo):
                hallazgos.append(Hallazgo("error", ruta, num, "except_pass",
                                          "`except ...: pass` oculta errores. Maneja el error o regístralo.",
                                          f"{anterior[1].strip()} / {codigo.strip()}"))
            for regla, patron, mensaje in AVISOS:
                if patron.search(codigo):
                    hallazgos.append(Hallazgo("warning", ruta, num, regla, mensaje, codigo.strip()))
            anterior = (num, codigo)

        # Heurística: router que opera sobre incidencias_campus sin filtro_alcance en el archivo.
        if ruta.startswith("backend/app/routers/") and any(OPERACION_INCIDENCIAS.search(c) for _, c in lineas):
            try:
                with open(ruta, encoding="utf-8") as f:
                    contenido = f.read()
            except OSError:
                contenido = ""
            if "filtro_alcance" not in contenido:
                num = next(n for n, c in lineas if OPERACION_INCIDENCIAS.search(c))
                hallazgos.append(Hallazgo(
                    "warning", ruta, num, "filtro_alcance",
                    "Este router consulta/modifica incidencias_campus pero no usa filtro_alcance(usuario): "
                    "un usuario podría ver o editar incidencias fuera de su alcance.",
                    "",
                ))
    return hallazgos


def main() -> int:
    p = argparse.ArgumentParser(description="Revisa reglas de base de datos en el diff del PR.")
    p.add_argument("--base", default="origin/dev", help="rama/commit base del PR (por defecto origin/dev)")
    base = p.parse_args().base

    hallazgos = revisar(base)
    errores = [h for h in hallazgos if h.nivel == "error"]
    avisos = [h for h in hallazgos if h.nivel == "warning"]
    en_ci = os.environ.get("GITHUB_ACTIONS") == "true"

    for h in hallazgos:
        etiqueta = "ERROR" if h.nivel == "error" else "AVISO"
        print(f"[{etiqueta}] {h.ruta}:{h.linea}  ({h.regla})  {h.mensaje}")
        if h.codigo:
            print(f"         > {h.codigo}")
        if en_ci:
            print(f"::{h.nivel} file={h.ruta},line={h.linea},title=reglas-bd: {h.regla}::{h.mensaje}")

    resumen = os.environ.get("GITHUB_STEP_SUMMARY")
    if resumen:
        with open(resumen, "a", encoding="utf-8") as f:
            f.write(f"## Reglas de BD\n\nErrores: **{len(errores)}** · Avisos: **{len(avisos)}**\n\n")
            for h in hallazgos:
                f.write(f"- {'❌' if h.nivel == 'error' else '⚠️'} `{h.ruta}:{h.linea}` **{h.regla}**: {h.mensaje}\n")

    if errores:
        print(f"\n{len(errores)} error(es) de reglas de BD. Revisa AGENTS.md (sección Base de datos) "
              "y docs/reglas/BASE-DE-DATOS.md.")
        return 1
    print(f"\nReglas de BD: sin errores ({len(avisos)} aviso(s)).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
