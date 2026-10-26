# Cómo contribuir a UTM Desk

Reglas de trabajo en equipo: ramas, commits, Pull Requests (PR) y CI. Si programas con IA, lee también [`AGENTS.md`](AGENTS.md). **¿Primera vez con Git?** Empieza por la guía paso a paso [`docs/reglas/GIT.md`](docs/reglas/GIT.md).

## 1. Ramas

| Rama | Para qué | Quién escribe |
|------|----------|---------------|
| `main` | Producción. Lo que está aquí se despliega. | Solo PR **desde `dev`** (release). |
| `dev` | Integración. Rama por defecto del repo. | Solo PR desde ramas de trabajo (squash). |
| `<tipo>/<issue>-<slug>` | Tu trabajo en un issue. Sale de `dev`. | Tú (y solo tú). |

Tipos de rama: `feat`, `fix`, `docs`, `test`, `chore`, `refactor`, `ci`.
Formato: `<tipo>/<número-de-issue>-<slug-en-minúsculas-con-guiones>`. Ejemplos:

```
feat/12-login-con-correo
fix/31-paginacion-incidencias
docs/7-guia-postman
```

El check `branch-flow` rechaza el PR si el nombre no cumple o si un PR a `main` no viene de `dev`.

**Prohibido:**
- Hacer commit o push directo a `dev` o `main` (están protegidas; el hook `no-commit-to-branch` lo evita en local).
- `git push --force` a `dev`/`main`. En **tu** rama usa solo `git push --force-with-lease` (después de un rebase).
- Trabajar en la rama de otra persona sin avisar.

## 2. Estrategia de merge (decisión y por qué)

- **Rama de trabajo → `dev`: _Squash and merge_.** Cada PR queda como **un solo commit** en `dev` con el título del PR (Conventional Commits). Resultado: historial lineal, 1 commit = 1 PR = 1 issue, fácil de revertir con `git revert <sha>`.
- **`dev` → `main`: _Create a merge commit_.** El merge commit marca la release y **conserva los mismos SHA** de `dev`. Si usáramos squash o rebase en este paso, GitHub crearía commits nuevos en `main` que no existen en `dev` y las dos ramas divergirían en cada release (habría que forzar `dev`, que está prohibido). Por eso `main` no exige historial lineal ni "rama al día": solo recibe merges de `dev`, así que nunca tiene contenido propio.
- Rebase merge está desactivado en el repo. Los métodos permitidos por rama los fija `scripts/github/proteger-ramas.sh` (rulesets).
- Hotfix: también va `fix/<issue>-…` → `dev` → PR `dev` → `main`. No hay atajos a `main`.

## 3. Flujo de trabajo paso a paso

1. **Toma un issue** (o créalo con la plantilla _Tarea_ o _Bug_) y asígnatelo.
2. **Crea tu rama desde `dev` actualizado:**
   ```bash
   git switch dev
   git pull --rebase
   git switch -c feat/12-login-con-correo
   ```
3. **Trabaja en commits pequeños** con Conventional Commits (ver §4).
4. **Antes de abrir el PR**, ponte al día con `dev` y corre las pruebas:
   ```bash
   git fetch origin
   git rebase origin/dev
   # backend
   cd backend && .venv/bin/ruff check . && .venv/bin/pytest tests -q && cd ..
   # frontend
   cd frontend && npm run lint && npm run build && cd ..
   # reglas de BD (las mismas que CI)
   python3 scripts/github/revisar_reglas_bd.py --base origin/dev
   git push -u origin HEAD            # la primera vez
   git push --force-with-lease        # si ya habías publicado y rebaseaste
   ```
5. **Abre el PR hacia `dev`** (la base por defecto). Llena la plantilla; el cuerpo debe tener `Closes #12`.
6. **Revisión:** 1 aprobación de un compañero y todas las conversaciones resueltas. Si alguien pide cambios, haz commits nuevos en tu rama (no hace falta reescribir).
7. **Merge:** _Squash and merge_ (lo hace el autor cuando todo está verde). La rama se borra sola.
8. **Release:** cuando el equipo lo decida, alguien abre un PR `dev` → `main` titulado `chore(release): <descripción>` y se mergea con _Create a merge commit_.

### Reglas del PR

- **1 PR = 1 issue**, enlazado con `Closes #N` (el issue se cierra solo al mergear en `dev`, que es la rama por defecto).
- **Tamaño sugerido: ≤ 400 líneas cambiadas** (sin contar `package-lock.json`). Si crece más, divide el issue.
- Título en Conventional Commits (lo valida `pr-rules`): será el mensaje del commit en `dev`.
- Conviene que la rama esté al día con `dev` (`pr-rules` solo avisa; no bloquea el merge). Si GitHub marca conflictos, usa `git merge origin/dev` o el botón _Update branch_.

## 4. Commits: Conventional Commits

```
<tipo>(<ámbito>): <descripción en minúscula e imperativo>
```

- Tipos: `feat`, `fix`, `docs`, `test`, `chore`, `refactor`, `perf`, `ci`, `build`, `style`, `revert`.
- Ámbitos sugeridos: `api`, `front`, `db`, `auth`, `ia`, `analitica`, `postman`, `ci`, `docs`.
- Ejemplos: `feat(api): agrega filtro por estado en GET /incidencias`, `fix(front): corrige doble envío del formulario`, `test(api): cubre 409 al cambiar estado`.

Activa la plantilla de mensaje (una vez por clon):

```bash
git config commit.template .gitmessage
```

## 5. Resolver conflictos durante un rebase

```bash
git fetch origin
git rebase origin/dev
```

Si aparece `CONFLICT (content): Merge conflict in <archivo>`:

1. `git status` → mira los archivos en _both modified_.
2. Abre cada archivo y busca los marcadores:
   ```
   <<<<<<< HEAD          ← lo que ya está en dev (upstream)
   ...
   =======
   ...
   >>>>>>> abc123 (tu commit)   ← tu cambio
   ```
   Ojo: en un rebase, `HEAD` es **dev** y lo de abajo es **tu** commit (al revés que en un merge).
3. Deja el código correcto (a veces ambas partes combinadas) y borra los marcadores.
4. Corre las pruebas de lo que tocaste.
5. `git add <archivo>` por cada archivo resuelto.
6. `git rebase --continue` (si se abre el editor, guarda el mensaje tal cual). Repite si hay más commits con conflicto.
7. ¿Te perdiste? `git rebase --abort` deja todo como antes de empezar.
8. Al terminar: `git push --force-with-lease`.

Consejos: si `package-lock.json` choca, toma la versión de dev (`git checkout --ours frontend/package-lock.json` — en rebase `--ours` es dev), luego `npm install` y `git add` el lock regenerado. Si el conflicto es en `scripts/init_db.py` o en esquemas, pide ayuda a quien es responsable de BD antes de resolver.

## 6. Si CI falla

1. Abre el PR → pestaña _Checks_ → el job en rojo → lee el primer error (no el último).
2. Reprodúcelo en local con el mismo comando (tabla abajo). No subas "intentos" a ciegas.
3. Corrige con un commit nuevo y `git push`.
4. **Nunca** desactives pruebas, bajes reglas de lint, agregues `# noqa`/`skip` ni toques los workflows para que "pase". Si crees que el check está mal, coméntalo en el PR y avisa al equipo.

| Check | Qué valida | Cómo reproducir en local |
|-------|-----------|--------------------------|
| `ci-ok` | Resume backend, frontend y postman (los que apliquen según rutas cambiadas). | Ver filas siguientes. |
| ↳ backend | `ruff check` + `pytest tests -q` con Mongo 7.0 (mongo:8 no arranca en kernels Linux ≥ 6.19) y Redis 7. | `docker compose up -d` y `cd backend && .venv/bin/ruff check . && .venv/bin/pytest tests -q` |
| ↳ frontend | `npm run lint` + `npm run build` (incluye `tsc -b`). | `cd frontend && npm ci && npm run lint && npm run build` |
| ↳ postman | `postman/*.json` es JSON válido. | `python3 -m json.tool postman/<archivo>.json` |
| `branch-flow` | Nombre de rama y que `main` solo reciba de `dev`. | Revisa el nombre: `git branch --show-current`. |
| `pr-rules` | Título Conventional Commits y `Closes #N` (avisa si la rama va atrás de `dev`). | Edita título/cuerpo del PR. |
| `gitleaks` | Secretos en los commits del PR. | `gitleaks git --config .github/gitleaks.toml --log-opts="origin/dev..HEAD"` |
| `reglas-bd` | Patrones peligrosos de BD/seguridad en el diff. | `python3 scripts/github/revisar_reglas_bd.py --base origin/dev` |

**Si `gitleaks` encuentra un secreto real:** rótalo de inmediato (cámbialo en Atlas/Upstash/B2/Anthropic), avisa al equipo y quítalo del historial de tu rama (`git rebase -i origin/dev`, editar el commit). Borrarlo en un commit nuevo **no** basta.

## 7. Herramientas locales (una vez por clon)

```bash
pip install pre-commit && pre-commit install   # ruff, ruff-format, gitleaks, JSON/YAML, no-commit a dev/main
git config commit.template .gitmessage
git config pull.rebase true                     # git pull hace rebase por defecto
git config rebase.autoStash true
```

## 8. Configuración inicial del repo (solo quien lo administra)

```bash
git remote add origin git@github.com:<owner>/<repo>.git
scripts/github/crear-ramas.sh                        # publica main y crea/publica dev
scripts/github/proteger-ramas.sh <owner> <repo> --dry-run   # revisa el JSON
scripts/github/proteger-ramas.sh <owner> <repo>             # aplica rulesets y rama por defecto = dev
```

Checks requeridos en `dev` y `main`: `ci-ok`, `branch-flow`, `pr-rules`, `gitleaks`, `reglas-bd`.

## 9. Cheat sheet

```bash
# Empezar un issue
git switch dev && git pull --rebase
git switch -c feat/12-login-con-correo

# Guardar avance
git add -p                      # revisa lo que agregas, trozo por trozo
git commit                      # usa la plantilla .gitmessage
git push -u origin HEAD         # primera vez

# Ponerte al día con dev
git fetch origin && git rebase origin/dev
git push --force-with-lease     # solo en TU rama

# Conflictos en rebase
git status                      # ver archivos en conflicto
git add <archivo> && git rebase --continue
git rebase --abort              # cancelar y volver al estado previo

# Arreglar el último commit (aún no revisado)
git commit --amend
git push --force-with-lease

# Deshacer cambios locales de un archivo
git restore <archivo>

# Guardar cambios sin commit para cambiar de rama
git stash && git switch otra-rama && git stash pop

# Ver qué va en tu PR
git log --oneline origin/dev..HEAD
git diff origin/dev...HEAD --stat

# Limpiar ramas ya mergeadas
git fetch --prune && git branch -vv | grep ': gone]'
git branch -D <rama>

# PR con gh
gh pr create --base dev --fill
gh pr checks --watch
```
