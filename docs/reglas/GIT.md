# Reglas de Git para el equipo (guía para quien empieza)

> Resumen en una línea: **nunca trabajes en `dev` ni en `main`; crea una rama por issue desde `dev`, ponte al día con `rebase`, sube tu rama y abre un Pull Request.**
> Esta guía explica el *por qué* y el *cómo*. El resumen técnico está en [`CONTRIBUTING.md`](../../CONTRIBUTING.md).

---

## 0. Las ramas del proyecto

```
main  ●───────────────●──────────────●        ← lo que se entrega/defiende. Solo recibe PR desde dev.
       \             /              /
dev     ●──●──●──●──●──●──●──●──●──●          ← integración: aquí se juntan las tareas terminadas.
            \   /     \     /
feat/12-…    ●─●       \   /                  ← TU rama: una por issue, vive pocos días.
fix/30-…                ●─●
```

| Rama | Quién escribe | Cómo entra el código |
|---|---|---|
| `main` | Nadie directo | PR `dev → main` cuando todo está verde y revisado |
| `dev` | Nadie directo | PR de tu rama → `dev` (squash: 1 PR = 1 commit) |
| `feat/…`, `fix/…`, etc. | Solo su dueño | Commits y push normales |

---

## 1. Configuración inicial (una vez por computadora)

```bash
git config --global user.name "Tu Nombre"
git config --global user.email "tu-correo@ejemplo.com"     # el mismo de tu cuenta de GitHub
git config --global init.defaultBranch main
git config --global pull.rebase true          # git pull hace rebase, no crea commits "Merge branch…"
git config --global rebase.autoStash true     # guarda y restaura tus cambios sin commit al hacer rebase
git config --global fetch.prune true          # borra referencias de ramas que ya no existen en GitHub
git config --global push.autoSetupRemote true # el primer push crea la rama remota automáticamente
git config --global core.editor "code --wait" # o nano/vim, el que uses
```

Dentro del proyecto (una vez por clon):

```bash
git clone https://github.com/canulcua123-source/campus-fix.git
cd campus-fix
git config commit.template .gitmessage        # plantilla de mensaje de commit
pip install pre-commit && pre-commit install  # revisa secretos, formato y bloquea commits en dev/main
```

---

## 2. Tu día a día (copia y pega)

### 2.1 Empezar una tarea

```bash
git switch dev                 # ve a dev (switch = checkout moderno para ramas)
git pull                       # trae lo último de GitHub (con rebase, por la configuración)
git switch -c feat/12-login-pantalla    # crea TU rama desde dev y cámbiate a ella
```

- El **número** es el del issue en GitHub (`#12`). El resto, minúsculas con guiones, describe la tarea.
- Prefijos: `feat/` función nueva · `fix/` corrección · `docs/` documentación · `test/` pruebas · `refactor/` reorganizar sin cambiar comportamiento · `chore/` mantenimiento · `ci/` workflows.
- Si la rama no cumple `tipo/numero-descripcion`, **el CI rechaza el PR**.

### 2.2 Trabajar y guardar avance

```bash
git status                     # ¿qué cambié? (úsalo todo el tiempo)
git diff                       # ver los cambios línea por línea ANTES de guardarlos
git add backend/app/routers/usuarios.py tests/e2e/test_usuarios.py   # agrega archivos concretos
git commit                     # abre la plantilla: feat(api): agrega edición de usuarios
```

- Commits **pequeños y frecuentes** (cada cosa que funciona = un commit).
- Evita `git add .` a ciegas: revisa con `git status` qué vas a incluir.
- Mensaje con formato *Conventional Commits*: `tipo(área): qué hace` en minúscula y en presente.
  - ✅ `fix(front): muestra error cuando el aula está vacía`
  - ❌ `cambios`, `ya quedó`, `asdf`, `Update file`

### 2.3 Subir tu rama

```bash
git push                       # la primera vez crea la rama en GitHub (push.autoSetupRemote)
```

Sube tu rama **al menos una vez al día** aunque no esté terminada: es tu respaldo.

### 2.4 Ponerte al día con `dev` (antes de abrir el PR y cada mañana)

```bash
git fetch origin
git rebase origin/dev          # pone tus commits ENCIMA de lo último de dev
# si hubo conflictos → sección 4
pytest / npm run build ...     # vuelve a probar: lo de otros puede afectar lo tuyo
git push --force-with-lease    # obligatorio tras un rebase de una rama ya subida (solo en TU rama)
```

### 2.5 Abrir el Pull Request

```bash
gh pr create --base dev --fill   # o desde la página de GitHub
```

- Título igual a un commit: `feat(front): pantalla de login`.
- En la descripción: `Closes #12` (cierra el issue al mergear) y llena el checklist de la plantilla.
- Pide revisión a un compañero. Responde los comentarios con nuevos commits en la misma rama.
- Cuando CI esté verde y haya 1 aprobación → **Squash and merge**. Se borra la rama sola.

### 2.6 Después del merge

```bash
git switch dev
git pull
git branch -d feat/12-login-pantalla   # borra tu rama local (ya está en dev)
```

---

## 3. Reglas (las que se revisan en cada PR)

| ID | Regla | Por qué |
|---|---|---|
| GIT-01 | **Nunca** hagas commit ni push a `dev` o `main`. | Están protegidas; el hook de pre-commit y GitHub lo bloquean. |
| GIT-02 | Una rama = un issue = un PR. | El revisor entiende el cambio y se puede revertir solo eso. |
| GIT-03 | Crea tu rama **desde `dev` actualizado**. | Si partes de algo viejo, tendrás conflictos de más. |
| GIT-04 | Ponte al día con `git rebase origin/dev`, **no** con `git merge dev`. | Historial limpio y lineal; el CI exige que estés al día. |
| GIT-05 | Después de un rebase usa `git push --force-with-lease`, **nunca** `git push --force`. | `--force-with-lease` no borra trabajo ajeno si alguien más subió algo. |
| GIT-06 | Solo reescribes historia (rebase, amend, force) **en tu propia rama**. | En ramas compartidas destruyes el trabajo de otros. |
| GIT-07 | PR pequeño: idealmente < 400 líneas cambiadas y < 1–2 días de trabajo. | Se revisa mejor y choca menos. |
| GIT-08 | Antes de pedir revisión, **corre las pruebas** (`pytest tests -q`, `npm run lint`, `npm run build`). | Si el CI falla, nadie revisa. |
| GIT-09 | **Nunca** subas `.env`, llaves, contraseñas, `node_modules`, `.venv` ni builds. | Un secreto subido se considera robado aunque lo borres. |
| GIT-10 | Revisa tu propio diff en GitHub antes de pedir revisión. | Atrapa archivos de más, prints, código comentado. |
| GIT-11 | No mezcles cambios de formato masivo con cambios de lógica. | El revisor no ve la lógica entre cientos de líneas de formato. |
| GIT-12 | Cambios en `scripts/init_db.py`, `package-lock.json` o `requirements*.txt`: **un PR a la vez** y avisando al grupo. | Son archivos que todos tocan; dos PR simultáneos chocan siempre. |
| GIT-13 | Si cambias el contrato de la API: primero el PR del backend, luego el del frontend. | El frontend no puede usar algo que todavía no existe. |
| GIT-14 | No dejes ramas abiertas más de 3 días sin hacer rebase. | Mientras más vieja, más conflictos. |
| GIT-15 | Si no sabes qué va a hacer un comando, **pregunta antes** (sobre todo `reset`, `rebase`, `push --force`, `clean`). | Casi todo se puede recuperar, pero cuesta tiempo. |

---

## 4. Conflictos en un rebase (no entres en pánico)

Pasa cuando tú y otra persona cambiaron las mismas líneas.

```bash
git rebase origin/dev
# CONFLICT (content): Merge conflict in frontend/src/api/client.ts
git status                      # te dice qué archivos tienen conflicto
```

Abre el archivo y busca las marcas:

```
<<<<<<< HEAD                 ← lo que ya está en dev (de tus compañeros)
const BASE = import.meta.env.VITE_API_URL;
=======
const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
>>>>>>> feat(front): …       ← tu cambio
```

1. Deja el código **correcto combinando ambos** (no borres el trabajo del otro sin entenderlo) y quita las marcas `<<<<<<<`, `=======`, `>>>>>>>`.
2. `git add frontend/src/api/client.ts`
3. `git rebase --continue` (repite si hay más commits con conflictos)
4. Corre las pruebas y `git push --force-with-lease`.

¿Te perdiste? `git rebase --abort` deja todo como estaba antes del rebase. Pide ayuda a quien escribió el otro cambio (`git log -p origin/dev -- archivo`).

---

## 5. "La regué": cómo arreglarlo

| Situación | Solución |
|---|---|
| Cambié un archivo y quiero descartarlo | `git restore archivo` |
| Agregué (`add`) un archivo que no debía | `git restore --staged archivo` |
| Quiero cambiar el mensaje o agregar algo al último commit (aún no revisado) | `git commit --amend` y luego `git push --force-with-lease` |
| Hice commits en `dev` por error (sin subir) | `git switch -c feat/NN-nombre` (te llevas los commits a una rama nueva) → `git switch dev` → `git reset --hard origin/dev` |
| Trabajé en la rama equivocada (sin commit) | `git stash` → `git switch rama-correcta` → `git stash pop` |
| Necesito cambiar de rama pero no quiero hacer commit aún | `git stash` (guardar) / `git stash pop` (recuperar) |
| Borré algo y quiero recuperarlo | `git reflog` muestra todo lo que hiciste; `git switch -c rescate <hash>` |
| Subí un secreto (`.env`, llave) | **Avisa de inmediato**. Se **cambia la llave** (rotarla) en el servicio; borrarla del historial no basta. |
| El CI falla en mi PR | Abre el job en rojo → lee el primer error → corrígelo localmente → commit → push. Nunca desactives una prueba para que pase. |
| Mi rama está muy atrasada y con muchos conflictos | `git rebase -i origin/dev` para juntar tus commits en uno y resolver una sola vez (pide ayuda la primera vez) |

---

## 6. Trabajar con IA (Claude Code, Codex, Copilot, Cursor) y Git

| ID | Regla |
|---|---|
| GIT-IA-01 | La IA **no** ejecuta `git push --force`, `git reset --hard`, `git clean -fd`, `git rebase` sobre `dev`/`main` ni borra ramas. Esos comandos los decides y corres tú. |
| GIT-IA-02 | Antes de cada commit lee el diff de la IA (`git diff`) completo. Si no entiendes una línea, no la subas. |
| GIT-IA-03 | Pide a la IA cambios pequeños y enfocados en tu issue; si toca archivos fuera de tu tarea, revierte esos archivos (`git restore archivo`). |
| GIT-IA-04 | La IA no edita `.env`, `scripts/init_db.py` (salvo el DBA), lockfiles ni `.github/` sin que lo pida el issue. |
| GIT-IA-05 | Marca en el PR "Usé IA: sí" y confirma que revisaste el código línea por línea (está en la plantilla). |
| GIT-IA-06 | Dale a la IA el issue y [`AGENTS.md`](../../AGENTS.md) al empezar; ahí están las reglas de base de datos y API. |

---

## 7. Cómo revisar el PR de un compañero

1. Lee el issue: ¿el PR hace lo que pide y **solo** eso?
2. Revisa la pestaña *Files changed*: nombres claros, sin código comentado, sin `print`/`console.log` olvidados, sin secretos.
3. ¿Hay pruebas para lo nuevo? ¿El CI está verde?
4. Si toca frontend: mira las capturas (celular y escritorio) y el checklist de [`UX-UI.md`](UX-UI.md).
5. Si toca API o BD: revisa [`CREAR-API.md`](CREAR-API.md) y [`BASE-DE-DATOS.md`](BASE-DE-DATOS.md).
6. Comenta con respeto y concreto: "Aquí falta el 404 cuando la incidencia es de otro edificio" en vez de "está mal".
7. Aprueba solo si lo entendiste. "LGTM" sin leer no es revisión.

---

## 8. Glosario mínimo

| Término | Qué es |
|---|---|
| **commit** | Una "foto" guardada de tus cambios con un mensaje. |
| **rama (branch)** | Una línea de trabajo separada; no afecta a las demás hasta que se une. |
| **checkout / switch** | Cambiarte de rama (`git switch` es la forma nueva y más clara). |
| **pull** | Traer cambios de GitHub a tu computadora. |
| **push** | Subir tus commits a GitHub. |
| **fetch** | Descargar la información de GitHub sin modificar tu rama. |
| **rebase** | Mover tus commits para que queden encima de lo más nuevo de otra rama. |
| **merge** | Unir dos ramas creando un commit de unión. |
| **squash** | Juntar varios commits en uno solo (así entran los PR a `dev`). |
| **PR (Pull Request)** | Solicitud para que tu rama entre a `dev`; ahí se revisa y corre el CI. |
| **CI** | Las pruebas automáticas que corre GitHub en cada PR. |
| **conflicto** | Dos personas cambiaron las mismas líneas; Git te pide decidir. |
| **stash** | Cajón temporal para guardar cambios sin hacer commit. |
| **reflog** | El historial de todo lo que hiciste en tu repo local; sirve para rescatar trabajo. |
