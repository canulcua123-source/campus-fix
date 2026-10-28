# Campus Fix · UTM Desk

[![CI](https://github.com/canulcua123-source/campus-fix/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/canulcua123-source/campus-fix/actions/workflows/ci.yml)

**Sistema de gestión, resolución y analítica de incidencias del campus.** Docentes, estudiantes y administrativos reportan fallas desde el celular con una foto; la IA llena el reporte, los técnicos le dan seguimiento y la coordinación ve métricas en tiempo real.

> Proyecto de la asignatura **Bases de Datos en la Nube** (Unidad II · NoSQL). Núcleo obligatorio: **MongoDB Atlas**.

| | |
|---|---|
| **Issues / tareas** | [github.com/canulcua123-source/campus-fix/issues](https://github.com/canulcua123-source/campus-fix/issues) · detalle en [`docs/TAREAS.md`](docs/TAREAS.md) |
| **Mockup visual** | [`docs/mockup-pwa.html`](docs/mockup-pwa.html) (ábrelo en el navegador) |
| **Requerimientos** | [`docs/UTM_Desk_Documentacion_Proyecto.docx`](docs/UTM_Desk_Documentacion_Proyecto.docx) |
| **Reglas del equipo** | [`CONTRIBUTING.md`](CONTRIBUTING.md) · [`AGENTS.md`](AGENTS.md) · [`docs/reglas/`](docs/reglas/) |

---

## ⛔ Antes de escribir una sola línea

1. Lee **[`docs/reglas/GIT.md`](docs/reglas/GIT.md)** si es tu primera vez con Git en equipo.
2. **Nunca** trabajes en `dev` ni en `main`. Rama por issue: `feat/<número-del-issue>-descripcion` desde `dev`.
3. **Nunca** subas `.env`, llaves ni contraseñas. **Nunca** conectes tu código ni tu IA a Atlas: se trabaja con Docker local.
4. Si programas con IA, dale primero [`AGENTS.md`](AGENTS.md) y el issue. Revisa **todo** su diff antes del commit.
5. Toda pantalla nueva sigue el **sistema de diseño** de abajo y el mockup. Nada de colores inventados.
6. Antes del PR: `ruff check` + `pytest tests -q` (backend) y `npm run lint` + `npm run build` (frontend). Si el CI está en rojo, nadie revisa.

---

## Arquitectura

**Monolito modular** en 3 capas con API REST, servicios externos detrás de puertos/adaptadores (almacenamiento e IA).

```
 PWA React (celular / PC) ──HTTPS + JWT──▶ API FastAPI ──▶ MongoDB Atlas M0 (documentos)
         │                                    │        └─▶ Redis (folio INCR, caché, límites)
         └── sube la foto con URL firmada ───▶│        └─▶ IA de visión (Gemini / Claude)
                                     Backblaze B2 (fotos y PDF) ◀── firma y verifica
```

| Capa | Tecnología |
|---|---|
| Frontend | React 19 + TypeScript · Vite · PWA (vite-plugin-pwa) · Tailwind 4 · React Router · TanStack Query · React Hook Form + Zod · Zustand · Recharts |
| Backend | FastAPI · PyMongo Async · Pydantic v2 · PyJWT · pwdlib (argon2) · slowapi |
| Datos | MongoDB Atlas M0 (colecciones `incidencias_campus`, `usuarios`, `roles`, `categorias`) |
| Apoyo | Redis (Upstash en la nube, Docker en local) · Backblaze B2 (compatible con S3) |
| Pruebas | pytest (208 e2e contra Mongo/Redis reales) · Postman (47 requests) · GitHub Actions |

---

## 🎨 Sistema de diseño (obligatorio)

La app debe **sentirse nativa** en iPhone y Android y verse igual en todas las pantallas. La fuente de verdad es **`frontend/src/styles/tokens.css`**; las reglas completas están en [`docs/reglas/UX-UI.md`](docs/reglas/UX-UI.md) y el aspecto en el [mockup](docs/mockup-pwa.html).

### Colores base

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `--color-primary` | `#1D4ED8` | `#60A5FA` | Botones principales, enlaces, pestaña activa, botón de cámara |
| `--color-on-primary` | `#FFFFFF` | `#0B1220` | Texto sobre el color primario |
| `--color-secondary` | `#0F766E` | `#2DD4BF` | Todo lo relacionado con la IA ("Sugerido por IA") |
| `--color-bg` | `#F2F2F7` | `#0B0F17` | Fondo de pantalla |
| `--color-surface` | `#FFFFFF` | `#151B26` | Tarjetas, barras, hojas |
| `--color-surface-2` | `#F8FAFC` | `#1E2633` | Fondos secundarios, selectores |
| `--color-border` | `#E5E7EB` | `#2A3342` | Bordes y divisores |
| `--color-text` | `#0F172A` | `#F1F5F9` | Texto principal |
| `--color-text-muted` | `#475569` | `#94A3B8` | Texto secundario (≥ 4.5:1 sobre `bg`, `surface` y `surface-2`) |
| `--color-border-strong` | `#64748B` | `#64748B` | Borde de campos y botón secundario (≥ 3:1) |
| `--color-focus` | `#1D4ED8` | `#93C5FD` | Anillo de foco (`:focus-visible`) |
| `--color-success` / `warning` / `danger` / `info` | `#166534` / `#92400E` / `#B91C1C` / `#0369A1` | `#4ADE80` / `#FBBF24` / `#F87171` / `#38BDF8` | Retroalimentación; texto encima con `--color-on-*` |

### Colores con significado (insignias)

Las insignias **siempre** llevan texto (nunca solo color) y usan pares **fondo + texto** (`--estado-abierta-bg` / `--estado-abierta-text`, etc.) con contraste ≥ 4.5:1 en ambos temas. En claro: fondo claro + texto oscuro; en oscuro: fondo oscuro + texto claro.

| Grupo | Valor | Fondo claro | Texto claro | Fondo oscuro | Texto oscuro |
|---|---|---|---|---|---|
| Estado | abierta | `#DBEAFE` | `#1D4ED8` | `#1E3A8A` | `#BFDBFE` |
| | en proceso | `#FEF3C7` | `#92400E` | `#78350F` | `#FDE68A` |
| | en espera | `#EDE9FE` | `#5B21B6` | `#4C1D95` | `#DDD6FE` |
| | resuelta | `#DCFCE7` | `#166534` | `#14532D` | `#BBF7D0` |
| | cerrada | `#E2E8F0` | `#334155` | `#334155` | `#E2E8F0` |
| | retirada | `#F1F5F9` | `#334155` | `#1E293B` | `#E2E8F0` |
| Prioridad | baja | `#E2E8F0` | `#334155` | `#334155` | `#E2E8F0` |
| | media | `#E0F2FE` | `#075985` | `#0C4A6E` | `#BAE6FD` |
| | alta | `#FFEDD5` | `#9A3412` | `#7C2D12` | `#FED7AA` |
| | crítica | `#FEE2E2` | `#B91C1C` | `#7F1D1D` | `#FECACA` |
| Categoría | cómputo y redes | `#CFFAFE` | `#155E75` | `#164E63` | `#A5F3FC` |
| | infraestructura | `#FEF3C7` | `#92400E` | `#78350F` | `#FDE68A` |
| | académico | `#FCE7F3` | `#9D174D` | `#831843` | `#FBCFE8` |
| IA | sugerido por IA | `#CCFBF1` | `#115E59` | `#134E4A` | `#99F6E4` |

Estos pares, los colores base y el anillo de foco (≥ 3:1) se verifican con la fórmula WCAG en `frontend/src/styles/tokens.test.ts` (corre con `npm test`): si cambias un token y baja de 4.5:1, la prueba falla.

Tema: claro, oscuro o automático (sigue `prefers-color-scheme`) desde **Perfil**; se guarda en el navegador (`src/lib/tema.ts`) y un script en `index.html` lo aplica antes de pintar para que no parpadee.

### Tipografía y medidas

| Elemento | Valor |
|---|---|
| Fuente | `var(--font-sans)`: San Francisco en iPhone, Roboto en Android. **No importes fuentes.** |
| Título grande (iOS) | 34 px bold · título de pantalla 22 px semibold |
| Texto | 17 px (iOS) / 16 px (Android) · secundario 13 px |
| Campos de formulario | **mínimo 16 px** (si no, iPhone hace zoom) |
| Radios | tarjetas `--radius-card` 14 px · campos `--radius-input` 10 px · hojas `--radius-sheet` 20 px · insignias `--radius-pill` 999 px |
| Toques | botones y zonas táctiles **≥ 44 × 44 px** (`--tap-min`) |
| Espaciado | múltiplos de 4 px |
| Zonas seguras | `--safe-top/right/bottom/left` (notch y barra de gestos) |

### Navegación

- **Celular (< 1024 px):** barra inferior translúcida con botón central de cámara (`AppShell`).
- **Computadora (≥ 1024 px):** menú lateral.
- Pestañas por rol: ver la matriz rol × pantalla en [`docs/TAREAS.md`](docs/TAREAS.md).

### ✅ Sí / ❌ No

| ✅ Sí | ❌ No |
|---|---|
| `className="bg-panel text-ink"` o `var(--color-surface)` | `style={{ color: '#3b82f6' }}` o colores de Tailwind sueltos (`bg-blue-500`) |
| Reusar los componentes de `components/ui` (`Button`, `Input`, `Badge`…) y `AppShell`; consultar `/_estilos` en `npm run dev` | Crear otro botón o insignia "parecido" |
| Estados de carga (skeleton), vacío, error con "Reintentar" y sin conexión en **cada** pantalla | Pantalla en blanco mientras carga |
| Error debajo del campo al salir de él, en español claro | `alert()` o "Error 400" |
| Probar en iPhone (Safari), Android (Chrome) y escritorio, en claro y oscuro | Probar solo en el navegador de la PC |
| Íconos `lucide-react` | Emojis como íconos |

---

## Puesta en marcha (local)

Requisitos: Python 3.12+, Node 22+, Docker, Git. Las versiones exactas están en `.python-version` y `.nvmrc` (las mismas que usa el CI); con `pyenv` y `nvm` se activan solas al entrar a la carpeta.

```bash
git clone https://github.com/canulcua123-source/campus-fix.git && cd campus-fix
pip install pre-commit && pre-commit install && git config commit.template .gitmessage

# 1. Mongo y Redis locales
docker compose up -d

# 2. Backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env                    # pon un JWT_SECRET de 32+ caracteres: openssl rand -hex 32
python scripts/init_db.py --seed-demo   # colecciones, $jsonSchema, índices, roles y datos demo
uvicorn app.main:app --reload           # http://localhost:8000/docs
pytest tests -q                         # 208 pruebas (necesitan el docker de arriba)

# 3. Frontend (otra terminal)
cd frontend
cp .env.example .env
npm install
npm run dev                             # http://localhost:5173
```

> El `.env` real con llaves de Atlas, Backblaze e IA **solo lo tiene el responsable de despliegue**. Para desarrollar no lo necesitas.

## Despliegue de la API (Render)

La API se publica en Render como servicio Docker gratuito definido en [`render.yaml`](render.yaml) (imagen: `backend/Dockerfile`, usuario no root, health check en `/health`). Cada push/merge a `main` despliega solo.

1. En Render: **New → Blueprint**, conecta el repositorio y elige la rama `main`. Render lee `render.yaml`.
2. Captura en el panel las variables marcadas `sync: false` (nunca en el repo): `MONGODB_URI` (usuario Atlas con permisos mínimos, no el admin), `REDIS_URL` (Upstash, `rediss://…`), `JWT_SECRET` (`openssl rand -hex 32`), `CORS_ORIGINS` (dominio exacto de la PWA, sin `*`), credenciales del bucket (`R2_*`, `STORAGE_*`) e IA (`IA_PROVEEDOR`, `ANTHROPIC_API_KEY`/`GEMINI_API_KEY`).
3. La PWA y la API están en dominios distintos, por eso `render.yaml` fija `REFRESH_COOKIE_SAMESITE=none` y `REFRESH_COOKIE_SECURE=true`.
4. IA: el despliegue usa **Gemini con llave gratuita** (`IA_PROVEEDOR=gemini`, `IA_PERMITIR_CAPA_GRATUITA=true`). En esa capa Google puede usar las fotos para mejorar sus productos; la PWA lo avisa al reportar. Ajusta el cupo diario global en **Configuración** (superadmin) al límite que muestre la consola de AI Studio.
5. Verifica: `GET https://<servicio>.onrender.com/health` → 200 y `/docs` accesible. Postman: carpetas *Auth* e *Incidencias* con el environment `UTM-Desk.prod`.

**Arranque en frío:** el plan gratuito duerme el servicio tras ~15 min sin tráfico; la primera petición tarda ~30–60 s. Antes de la demo, despiértalo abriendo `/health` unos minutos antes.

Prueba local de la imagen (sin el `.env` real):

```bash
docker build -t utm-desk-api backend
docker run --rm -p 8000:8000 -e MONGODB_URI=mongodb://host.docker.internal:27017 \
  -e REDIS_URL=redis://host.docker.internal:6379/0 -e JWT_SECRET=$(openssl rand -hex 32) utm-desk-api
```

## Despliegue de la PWA (Cloudflare Pages)

1. Cloudflare → **Workers & Pages → Create → Pages → Connect to Git**, repositorio `campus-fix`, rama `main`.
2. Configuración de build: *Root directory* `frontend`, *Build command* `npm ci && npm run build`, *Output* `dist`, variable `NODE_VERSION` = la de `.nvmrc`.
3. Variables de entorno (Production): `VITE_API_URL=https://<servicio>.onrender.com` y `VITE_DOMINIO_CORREO=utm.edu.mx`. Se leen **al compilar**: si cambian, vuelve a desplegar.
4. Copia el dominio que te da Pages (`https://<proyecto>.pages.dev`) a `CORS_ORIGINS` en Render y redepliega la API.
5. `frontend/public/_redirects` sirve la SPA en cualquier ruta y `_headers` añade cabeceras de seguridad y evita cachear `sw.js`/`index.html` (para que lleguen las actualizaciones).

## CI

GitHub Actions ejecuta el pipeline en cada Pull Request hacia `dev` o `main` y en cada push a `dev`. Los jobs se filtran por las rutas modificadas y el check final obligatorio es `ci-ok`.

Para reproducirlo localmente con MongoDB y Redis de Docker:

```bash
docker compose up -d

cd backend
pip install -r requirements.txt -r requirements-dev.txt
ruff check .
pytest tests -q

cd ../frontend
npm ci
npm run lint
npm run build
```

`npm run build` ejecuta `tsc -b` antes de `vite build`. La suite backend usa únicamente `mongodb://localhost:27017` y Redis local; no requiere Atlas, Backblaze B2 ni credenciales reales.

### Variables de entorno (backend)

| Variable | Para qué | Local |
|---|---|---|
| `MONGODB_URI` / `MONGODB_DB` | Base de datos | `mongodb://localhost:27017` / `utm_desk` |
| `MONGODB_ADMIN_URI` | Solo `init_db.py` en Atlas (usuario con dbAdmin) | vacío |
| `REDIS_URL` | Folio, caché, límites | `redis://localhost:6379/0` |
| `DOMINIO_CORREO` | Dominio exacto de las cuentas institucionales, sin `@` | `utm.edu.mx` |
| `JWT_SECRET` | Firma de tokens (≥ 32 caracteres o la API no arranca) | `openssl rand -hex 32` |
| `CORS_ORIGINS` | Orígenes del frontend | `http://localhost:5173` |
| `STORAGE_ENDPOINT` / `STORAGE_REGION` | Backblaze B2 (S3) | vacío |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | Llaves del bucket | vacío |
| `IA_HABILITADA` / `IA_MODELO` / `ANTHROPIC_API_KEY` | Análisis de foto | `false` en local |
| `IA_PROVEEDOR` (`claude`\|`gemini`) / `GEMINI_API_KEY` / `GEMINI_MODELO` | Proveedor de visión del puerto `ProveedorVision`; cambiarlo no toca el router | `claude` |
| `GEMINI_CAPA` (`gratuita`\|`pagada`) / `IA_PERMITIR_CAPA_GRATUITA` | Con `false` (producción) se bloquea Gemini en capa gratuita: usa las fotos para mejorar productos | `gratuita` / `false` |
| `IA_UMBRAL_COSTO_DIARIO_USD` | Alerta administrativa de costo estimado diario (opcional) | vacío |

Frontend: `VITE_API_URL` (por defecto `http://localhost:8000`) y `VITE_DOMINIO_CORREO` (debe coincidir con `DOMINIO_CORREO`).

### Configuración administrable de IA

`IA_HABILITADA`, `IA_LIMITE_DIARIO=20` e `IA_LIMITE_GLOBAL_DIARIO=300` son únicamente los valores
iniciales que `scripts/init_db.py` inserta la primera vez. Después, MongoDB (`configuracion_ia`, documento
`ia`) es la fuente de verdad. `GET/PATCH /config/ia` requieren `configuracion:gestionar`, permiso sembrado
solo para el rol superadministrador (`superadmin`). Redis guarda una copia con TTL de 60 segundos; si la caché falla se lee
MongoDB y una actualización sigue persistiendo.

El modo agéntico (T-034) también se administra ahí, no en `.env`: `modo_agentico_habilitado` (*kill switch*,
`false` por defecto), `categorias_agenticas` (`["infraestructura"]`), `cupo_agentico_usuario_diario` (10) y
`cupo_agentico_aula_hora` (3). `init_db.py` completa estos campos en documentos existentes sin tocar los valores ya
configurados. Si el cupo agéntico está agotado, `/ia/analizar-imagen` responde `formulario` (G9) en lugar de
gastar el análisis; los tres permisos (`ia:usar`, `incidencias:crear`, `evidencias:subir`) se exigen con
`require_permisos` en `POST /incidencias/desde-foto` (T-036).

`ia_sugerencia` es opcional en `POST /incidencias` y sigue `IASugerencia` (`modo`, `modelo`, `version_prompt`,
`confianza`, `campos_autollenados` y opcionales como `accion`). Solo se guarda cuando el cliente la incluye: analizar una imagen nunca crea
ni modifica incidencias. Con IA deshabilitada o con fallo del proveedor, `/ia/analizar-imagen` devuelve 503
y el alta manual permanece independiente. Al proveedor solo se envían la imagen, su tipo y el contexto
escrito explícitamente; no se incorporan nombre, correo ni otros datos del perfil autenticado.

### Producción detrás del balanceador del hosting

El hosting (Render, Koyeb, etc.) pone un proxy/balanceador delante de la API. Arráncala así para que los límites por IP vean la IP real del cliente y no la del proxy:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips="*"   # solo si el puerto NO es público fuera del proxy
```

La API no guarda estado en memoria (sesión en el JWT, contadores en Redis), así que se pueden levantar varias instancias detrás del balanceador sin cambiar código. `CORS_ORIGINS` debe listar el dominio real del frontend (nunca `*`).

---

## Estructura

```
campus-fix/
├── AGENTS.md / CLAUDE.md        # reglas para quien programa con IA
├── CONTRIBUTING.md              # flujo de ramas, commits y PR
├── .github/                     # CI, plantillas de issue/PR, CODEOWNERS
├── docker-compose.yml           # mongo:7.0 + redis:7
├── docs/
│   ├── reglas/                  # GIT, UX-UI, API, FRONT-BACK, CREAR-API, BASE-DE-DATOS
│   ├── TAREAS.md                # backlog con criterios y matriz de conflictos
│   ├── algoritmo-foto-ia.md     # flujo foto → IA (modo asistido y agéntico)
│   └── mockup-pwa.html          # cómo se ve la app
├── postman/                     # banco de pruebas de la API
├── scripts/github/              # protección de ramas, issues, revisor de reglas de BD
├── backend/
│   ├── app/
│   │   ├── core/                # config, db, security (JWT, permisos, alcance), storage, limiter
│   │   ├── routers/             # auth, incidencias, ia, roles, usuarios, categorias, analitica
│   │   ├── schemas/             # contratos Pydantic
│   │   └── services/ia.py       # proveedor de IA
│   ├── scripts/init_db.py       # ÚNICO lugar para cambiar el esquema (solo el DBA)
│   └── tests/e2e/               # pruebas contra Mongo/Redis reales
└── frontend/src/
    ├── styles/tokens.css        # ← colores y medidas (fuente de verdad)
    ├── components/              # AppShell, Badge, … (reutilízalos)
    ├── api/client.ts            # único cliente HTTP
    ├── auth/                    # sesión y RequirePermiso
    ├── schemas/                 # Zod (espejo de Pydantic)
    └── pages/                   # una pantalla por archivo
```

---

## Equipo

> ✏️ Cada integrante: revisa **tu fila** y corrige tu nombre completo o rol si hace falta (botón ✏️ en GitHub sobre este archivo, en la rama del PR).

| Integrante | GitHub | Rol en el equipo | Responsable de |
|---|---|---|---|
| Líder del proyecto | [@canulcua123-source](https://github.com/canulcua123-source) | **Líder / arquitecto** | Base visual (#76), arquitectura, coordinación, documento y defensa |
| Diego Solís | [@Genokiller05](https://github.com/Genokiller05) | **Frontend / UX** | Pantallas de la PWA, formularios, dashboard |
| Bogarth Peña *(por confirmar)* | [@raiden3893](https://github.com/raiden3893) | **Backend + Base de datos** | API FastAPI, MongoDB, `init_db.py`, IA en el servidor |
| Yael Rodríguez | [@Nanashi31](https://github.com/Nanashi31) | **QA / DevOps** | Pruebas, Postman, CI, despliegue y revisión de criterios en cada PR |

**Revisar es de todos:** cada PR necesita la aprobación de otro integrante. GitHub pide automáticamente la revisión del dueño del área según [`.github/CODEOWNERS`](.github/CODEOWNERS).

## Roles del sistema

| Rol | Ve | Puede |
|---|---|---|
| Reportante | Solo sus reportes | Crear con foto + IA, subir evidencias |
| Técnico | Su área | Seguimiento, etiquetas, evidencias, búsqueda |
| Coordinador | Su área | Lo del técnico + asignar, cerrar, métricas |
| Directivo | Todo (solo lectura) | Dashboard y búsqueda |
| Admin | Todo | Usuarios, roles (con alcance) y categorías |

Los permisos se validan **en el backend** en cada petición (`require_permiso` + `filtro_alcance`); ocultar un botón en el frontend no es seguridad.

---

## Flujo de trabajo (resumen)

```bash
git switch dev && git pull
git switch -c feat/12-pantalla-login     # 12 = número del issue
# … commits pequeños …
git fetch origin && git rebase origin/dev
git push --force-with-lease               # (o git push la primera vez)
gh pr create --base dev                   # con "Closes #12" en la descripción
```

`dev` recibe PRs con *squash*; `main` solo recibe PRs desde `dev` con el CI en verde. Detalle en [`CONTRIBUTING.md`](CONTRIBUTING.md) y [`docs/reglas/GIT.md`](docs/reglas/GIT.md).
