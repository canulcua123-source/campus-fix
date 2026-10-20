#!/usr/bin/env python3
"""Crea labels, milestones e issues del backlog de UTM Desk en GitHub usando `gh`.

Fuente de datos: scripts/github/tareas.json (la misma que genera docs/TAREAS.md).

Uso:
    python3 scripts/github/crear-issues.py                 # --dry-run por defecto: solo imprime
    python3 scripts/github/crear-issues.py --ejecutar --repo canulcua123-source/campus-fix
    python3 scripts/github/crear-issues.py --ejecutar --repo owner/repo --solo T-001,T-002

Idempotente: no crea un issue si ya existe otro (abierto o cerrado) cuyo título empiece con "T-0XX".
Labels se crean con --force (actualiza color/descripción); milestones solo si no existen.
Requiere `gh auth login` previo para --ejecutar.
"""

from __future__ import annotations

import argparse
import json
import re
import shlex
import subprocess
import sys
from pathlib import Path

DATOS = Path(__file__).with_name("tareas.json")

MILESTONES = {
    "F1": ("Fase 1", "Entrega de avances técnicos: API, PWA conectada, Atlas con demo, documento Fase 1."),
    "F2": ("Fase 2", "Documento final APA 7, IA, categorías dinámicas, banco Postman y defensa."),
}

COLORES = {
    "epica": "1D76DB",
    "rol": "5319E7",
    "prioridad:debe": "B60205",
    "prioridad:deberia": "FBCA04",
    "prioridad:podria": "C2E0C6",
    "fase": "0E8A16",
    "requiere-aprobacion": "D93F0B",
}

REPO_PROYECTO = "canulcua123-source/campus-fix"


def slug(texto: str) -> str:
    import unicodedata

    t = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")


def label_prioridad(p: str) -> str:
    return "prioridad:" + slug(p)


def labels_de(t: dict) -> list[str]:
    lbs = [f"epica:{t['epica']}", f"rol:{t['rol']}", label_prioridad(t["prioridad"]), f"fase:{t['fase'].lower()}"]
    if t.get("requiere_aprobacion"):
        lbs.append("requiere-aprobacion")
    return lbs


def catalogo_labels(datos: dict) -> list[tuple[str, str, str]]:
    out = []
    for k, nombre in datos["epicas"].items():
        out.append((f"epica:{k}", COLORES["epica"], f"Épica: {nombre}"))
    for k, nombre in datos["roles"].items():
        out.append((f"rol:{k}", COLORES["rol"], f"Responsable: {nombre}"))
    for p in ("Debe", "Debería", "Podría"):
        lb = label_prioridad(p)
        out.append((lb, COLORES[lb], f"Prioridad MoSCoW: {p}"))
    for f in ("f1", "f2"):
        out.append((f"fase:{f}", COLORES["fase"], MILESTONES[f.upper()][0]))
    out.append(("requiere-aprobacion", COLORES["requiere-aprobacion"], "Cambia reglas de negocio o de BD: pendiente de aprobación del PO"))
    return out


def titulo_issue(t: dict) -> str:
    return f"{t['id']} · {t['titulo']}"


def cuerpo(t: dict, datos: dict, numeros: dict[str, int]) -> str:
    rol = datos["roles"][t["rol"]]
    epica = datos["epicas"][t["epica"]]
    deps = ", ".join(f"{d} (#{numeros[d]})" if d in numeros else d for d in t["depende"]) or "Ninguna"
    tipo = "fix" if t["titulo"].startswith("BUG") else "docs" if t["epica"] == "docs-defensa" else "feat"
    corto = "-".join(slug(t["titulo"].removeprefix("BUG:")).split("-")[:6])
    rama = f"{tipo}/<número de este issue>-{corto}"  # el CI exige tipo/<número>-slug
    L = []
    if t.get("requiere_aprobacion"):
        L += ["> ⚑ **Pendiente de aprobación del PO** (cambia reglas de negocio o de BD). No empezar hasta que el PO lo apruebe en este issue.", ""]
    L += [
        f"**Épica:** {epica} · **Rol responsable:** {rol} · **Prioridad:** {t['prioridad']} · "
        f"**Fase:** {t['fase']} · **Semana sugerida:** {t['semana']} · **Estimación:** {t['horas']} h",
        f"**Cubre:** {', '.join(t['cubre'])}",
        f"**Depende de:** {deps}",
        "",
        "## Descripción",
        t["descripcion"],
        "",
        "**Archivos a tocar:**",
        *[f"- `{a}`" for a in t["archivos"]],
        "",
        "## Criterios de aceptación",
        *[f"- [ ] {c}" for c in t["criterios"]],
        "",
        "## Pruebas requeridas",
        *[f"- [ ] {p}" for p in t["pruebas"]],
        "",
        "## Definición de terminado",
        *[f"- [ ] {d}" for d in datos["dod_comun"] + t.get("dod_extra", [])],
        "",
        "## Cómo tomarla",
        f"Asígnate el issue, crea la rama `{rama}` desde `dev` (ej. `{tipo}/12-{corto}` si este issue es el #12) y abre el PR hacia `dev` con `Closes #<este issue>`.",
        "",
        "_Generado desde `scripts/github/tareas.json` (ver `docs/TAREAS.md`)._",
    ]
    return "\n".join(L)


def gh(args: list[str], ejecutar: bool, capturar: bool = False) -> str:
    if not ejecutar:
        print("$ gh " + " ".join(shlex.quote(a) for a in args))
        return ""
    r = subprocess.run(["gh", *args], text=True, capture_output=True)
    if r.returncode != 0:
        sys.exit(f"Error en `gh {' '.join(args[:3])}`: {r.stderr.strip()}")
    return r.stdout if capturar else ""


def issues_existentes(repo: str) -> dict[str, int]:
    salida = gh(
        ["issue", "list", "--repo", repo, "--state", "all", "--limit", "1000", "--json", "number,title"],
        True,
        capturar=True,
    )
    existentes = {}
    for it in json.loads(salida or "[]"):
        m = re.match(r"^(T-\d{3})\b", it["title"])
        if m:
            existentes[m.group(1)] = it["number"]
    return existentes


def milestones_existentes(repo: str) -> set[str]:
    salida = gh(["api", f"repos/{repo}/milestones?state=all&per_page=100"], True, capturar=True)
    return {m["title"] for m in json.loads(salida or "[]")}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    modo = ap.add_mutually_exclusive_group()
    modo.add_argument("--dry-run", action="store_true", default=True, help="Solo imprime (por defecto)")
    modo.add_argument("--ejecutar", action="store_true", help="Crea labels, milestones e issues en GitHub")
    ap.add_argument("--repo", help=f"owner/repo (obligatorio con --ejecutar; el del proyecto es {REPO_PROYECTO})")
    ap.add_argument("--solo", help="IDs separados por coma, ej. T-001,T-002")
    ap.add_argument("--mostrar-cuerpo", action="store_true", help="En dry-run, imprime el cuerpo de cada issue")
    a = ap.parse_args()

    ejecutar = a.ejecutar
    if ejecutar and not a.repo:
        ap.error("--ejecutar requiere --repo owner/repo")
    repo = a.repo or REPO_PROYECTO

    datos = json.loads(DATOS.read_text(encoding="utf-8"))
    tareas = datos["tareas"]
    ids = {t["id"] for t in tareas}
    for t in tareas:
        faltan = [d for d in t["depende"] if d not in ids]
        if faltan:
            sys.exit(f"{t['id']} depende de IDs inexistentes: {faltan}")
    if a.solo:
        filtro = {s.strip() for s in a.solo.split(",")}
        tareas = [t for t in tareas if t["id"] in filtro]

    print(f"# Modo: {'EJECUTAR' if ejecutar else 'DRY-RUN'} · repo: {repo} · tareas: {len(tareas)}")

    # 1. Labels
    for nombre, color, desc in catalogo_labels(datos):
        gh(["label", "create", nombre, "--repo", repo, "--color", color, "--description", desc, "--force"], ejecutar)

    # 2. Milestones
    ya = milestones_existentes(repo) if ejecutar else set()
    for titulo, desc in MILESTONES.values():
        if titulo in ya:
            print(f"= milestone '{titulo}' ya existe")
            continue
        gh(["api", f"repos/{repo}/milestones", "-f", f"title={titulo}", "-f", f"description={desc}"], ejecutar)

    # 3. Issues (idempotente por prefijo T-0XX)
    numeros = issues_existentes(repo) if ejecutar else {}
    creados: list[dict] = []
    for t in tareas:
        if t["id"] in numeros:
            print(f"= {t['id']} ya existe como #{numeros[t['id']]}, se omite")
            continue
        args = ["issue", "create", "--repo", repo, "--title", titulo_issue(t),
                "--milestone", MILESTONES[t["fase"]][0], "--body", cuerpo(t, datos, numeros)]
        for lb in labels_de(t):
            args += ["--label", lb]
        if ejecutar:
            url = gh(args, True, capturar=True).strip()
            numeros[t["id"]] = int(url.rsplit("/", 1)[-1])
            creados.append(t)
            print(f"+ {t['id']} → {url}")
        else:
            shown = [x if x != args[args.index('--body') + 1] else "<cuerpo>" for x in args]
            gh(shown, False)
            if a.mostrar_cuerpo:
                print(cuerpo(t, datos, numeros) + "\n" + "-" * 60)

    # 4. Segunda pasada: enlazar dependencias que se crearon después
    for t in creados:
        if any(d in numeros for d in t["depende"]):
            gh(["issue", "edit", str(numeros[t["id"]]), "--repo", repo, "--body", cuerpo(t, datos, numeros)], True)

    print(f"# Listo: {len(creados) if ejecutar else len(tareas)} issue(s) {'creados' if ejecutar else 'por crear'}.")


if __name__ == "__main__":
    main()
