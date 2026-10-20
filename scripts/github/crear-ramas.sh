#!/usr/bin/env bash
# Crea `dev` desde `main` y publica ambas ramas en el remoto.
#
# Uso (desde la raíz del repo, con el remoto ya configurado):
#   scripts/github/crear-ramas.sh [remoto]      # remoto por defecto: origin
#
# Requiere al menos un commit en main. Es idempotente: no recrea `dev` si ya existe.
set -euo pipefail

REMOTO="${1:-origin}"

git rev-parse --is-inside-work-tree > /dev/null 2>&1 || { echo "No estás dentro de un repo git."; exit 1; }
cd "$(git rev-parse --show-toplevel)"
git remote get-url "$REMOTO" > /dev/null 2>&1 || {
  echo "No existe el remoto '$REMOTO'. Agrégalo: git remote add $REMOTO git@github.com:<owner>/<repo>.git"; exit 1; }
git rev-parse --verify --quiet main > /dev/null || { echo "La rama main no tiene commits todavía. Haz el commit inicial."; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Tienes cambios sin commit. Haz commit o stash antes."; exit 1; }

git fetch "$REMOTO" --prune

if git ls-remote --exit-code --heads "$REMOTO" main > /dev/null; then
  echo "-> main ya existe en $REMOTO"
else
  echo "-> Publicando main"
  git push -u "$REMOTO" main
fi

if git ls-remote --exit-code --heads "$REMOTO" dev > /dev/null; then
  echo "-> dev ya existe en $REMOTO (no se modifica)"
  git rev-parse --verify --quiet dev > /dev/null || git branch --track dev "$REMOTO/dev"
else
  git rev-parse --verify --quiet dev > /dev/null || git branch dev main
  echo "-> Publicando dev"
  git push -u "$REMOTO" dev
fi

git switch dev
echo "Listo. Ramas: main (producción) y dev (integración). Trabaja siempre desde dev."
echo "Siguiente paso: scripts/github/proteger-ramas.sh <owner> <repo>"
