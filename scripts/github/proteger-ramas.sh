#!/usr/bin/env bash
# Configura la protección de `main` y `dev` con Rulesets de GitHub (vía `gh api`).
#
# Uso:
#   scripts/github/proteger-ramas.sh <owner> <repo> [--dry-run]
#
# Requisitos: gh autenticado (gh auth login) con permisos de admin en el repo, y que
# `dev` ya exista (scripts/github/crear-ramas.sh). Los rulesets en repos PRIVADOS requieren
# GitHub Pro/Team (o GitHub Education); en repos públicos funcionan en el plan gratis.
#
# Es idempotente: si el ruleset ya existe (por nombre) lo actualiza.
set -euo pipefail

uso() { echo "Uso: $0 <owner> <repo> [--dry-run] [--admin-bypass]" >&2; exit 2; }
[ $# -ge 2 ] || uso
OWNER="$1"; REPO="$2"; shift 2
DRY_RUN=false
# --admin-bypass: los administradores del repo pueden saltarse las reglas SOLO desde un PR
# (nunca con push directo). Útil mientras el equipo tiene una sola persona que pueda aprobar.
# Quítalo (vuelve a correr el script sin la opción) cuando haya al menos 2 revisores.
BYPASS='[]'
for a in "$@"; do
  case "$a" in
    --dry-run) DRY_RUN=true ;;
    --admin-bypass) BYPASS='[{"actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "pull_request"}]' ;;
    *) uso ;;
  esac
done
R="repos/$OWNER/$REPO"

# Checks requeridos = `name:` de los jobs (no el nombre del workflow).
CHECKS='[
  {"context": "ci-ok"},
  {"context": "branch-flow"},
  {"context": "pr-rules"},
  {"context": "gitleaks"},
  {"context": "reglas-bd"}
]'

# $1 = nombre, $2 = rama, $3 = métodos de merge permitidos (JSON), $4 = linear history (true/false),
# $5 = exigir rama al día (strict)
ruleset() {
  local nombre="$1" rama="$2" metodos="$3" lineal="$4" strict="$5"
  local extra=""
  if [ "$lineal" = "true" ]; then extra='{"type": "required_linear_history"},'; fi
  cat <<JSON
{
  "name": "$nombre",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": $BYPASS,
  "conditions": { "ref_name": { "include": ["refs/heads/$rama"], "exclude": [] } },
  "rules": [
    {"type": "deletion"},
    {"type": "non_fast_forward"},
    $extra
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true,
        "allowed_merge_methods": $metodos
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": $strict,
        "do_not_enforce_on_create": false,
        "required_status_checks": $CHECKS
      }
    }
  ]
}
JSON
}

# dev: squash (1 PR = 1 commit), historial lineal, al día con dev.
# main: merge commit desde dev (conserva los SHAs de dev; ver CONTRIBUTING.md). Sin "strict":
#       main solo contiene merges de dev, así que dev nunca diverge en contenido.
DEV_JSON="$(ruleset "proteccion-dev" "dev" '["squash"]' true true)"
MAIN_JSON="$(ruleset "proteccion-main" "main" '["merge"]' false false)"

REPO_JSON='{
  "allow_squash_merge": true,
  "allow_merge_commit": true,
  "allow_rebase_merge": false,
  "allow_update_branch": true,
  "delete_branch_on_merge": true,
  "squash_merge_commit_title": "PR_TITLE",
  "squash_merge_commit_message": "PR_BODY",
  "merge_commit_title": "PR_TITLE",
  "merge_commit_message": "PR_BODY",
  "default_branch": "dev"
}'

aplicar_ruleset() {
  local nombre="$1" json="$2" id
  id="$(gh api "$R/rulesets" --jq ".[] | select(.name == \"$nombre\") | .id")"
  if [ -n "$id" ]; then
    echo "-> Actualizando ruleset $nombre (id $id)"
    printf '%s' "$json" | gh api -X PUT "$R/rulesets/$id" --input - --jq '.name + " OK"'
  else
    echo "-> Creando ruleset $nombre"
    printf '%s' "$json" | gh api -X POST "$R/rulesets" --input - --jq '.name + " OK"'
  fi
}

if $DRY_RUN; then
  echo "### [dry-run] PATCH $R"; echo "$REPO_JSON"
  echo "### [dry-run] POST/PUT $R/rulesets (proteccion-dev)"; echo "$DEV_JSON"
  echo "### [dry-run] POST/PUT $R/rulesets (proteccion-main)"; echo "$MAIN_JSON"
  # Verifica que los JSON sean válidos.
  for j in "$REPO_JSON" "$DEV_JSON" "$MAIN_JSON"; do printf '%s' "$j" | python3 -m json.tool > /dev/null; done
  echo "### [dry-run] JSON válidos. No se envió nada."
  exit 0
fi

command -v gh > /dev/null || { echo "Falta gh (https://cli.github.com)"; exit 1; }
gh api "$R/branches/main" --silent || { echo "No existe la rama main en $OWNER/$REPO"; exit 1; }
gh api "$R/branches/dev" --silent || { echo "No existe la rama dev: corre scripts/github/crear-ramas.sh"; exit 1; }

echo "-> Ajustes del repo (métodos de merge, rama por defecto = dev)"
printf '%s' "$REPO_JSON" | gh api -X PATCH "$R" --input - --jq '"default_branch=" + .default_branch'
aplicar_ruleset "proteccion-dev" "$DEV_JSON"
aplicar_ruleset "proteccion-main" "$MAIN_JSON"
echo "Listo. Revisa: https://github.com/$OWNER/$REPO/settings/rules"
