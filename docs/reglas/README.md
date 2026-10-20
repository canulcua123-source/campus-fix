# Reglas del equipo · UTM Desk

Reglas obligatorias para todo el código de UTM Desk (PWA + API + MongoDB). Están escritas a partir del **código real** del repositorio: cuando una regla cita una función o archivo, es porque ya existe y hay que reutilizarlo.

Las usamos tanto personas como asistentes de IA. Si programas con IA, **pega en el prompt el documento que aplica** (por ejemplo `CREAR-API.md` si vas a crear un endpoint) y pídele que lo cumpla.

## Índice

| Documento | Prefijo de ID | Cuándo leerlo |
|---|---|---|
| [GIT.md](GIT.md) | `GIT-xx` | Antes de tu primer commit: ramas, rebase, push, PR, conflictos, cómo arreglar errores |
| [UX-UI.md](UX-UI.md) | `UX-xx` | Cualquier cambio visual o de pantalla en `frontend/` |
| [API.md](API.md) | `API-xx` | Diseñar o cambiar un endpoint (forma de URL, códigos, JSON) |
| [FRONT-BACK.md](FRONT-BACK.md) | `FB-xx` | Consumir la API desde la PWA; cambiar un schema Pydantic o Zod |
| [CREAR-API.md](CREAR-API.md) | `CA-xx` | Paso a paso (Definition of Done) para un endpoint nuevo, con plantillas |
| [BASE-DE-DATOS.md](BASE-DE-DATOS.md) | `BD-xx` | Modelar documentos, índices, `init_db.py`, Atlas, respaldos |

Documentos de referencia: `docs/UTM_Desk_Documentacion_Proyecto.docx` (requerimientos RF/RNF, secciones 3, 6, 7 y 9) y `docs/mockup-pwa.html` (aspecto visual esperado).

## Niveles

- **DEBE** (sin marca): obligatorio. Un PR que lo incumple no se aprueba.
- **(recomendado)**: buena práctica; si no se cumple, explica por qué en el PR.

## Cómo se usan en las revisiones de PR

1. **El autor** marca en la descripción del PR qué documentos aplican y pega el checklist final de cada uno, con las casillas marcadas.
2. Si alguna regla no se cumple a propósito, escribe `Excepción UX-07: <motivo>`. Sin motivo escrito no hay excepción.
3. **El revisor** comenta citando el ID: `❌ API-08: este 403 revela que la incidencia existe; debe ser 404`. Así el autor sabe exactamente qué leer.
4. Un PR que toca `backend/app/schemas/` **también** debe tocar `frontend/src/schemas/` (FB-12) y la colección de Postman (API-24), o explicar por qué no.
5. Un PR que toca `backend/scripts/init_db.py` necesita la aprobación del **DBA** (BD-20).
6. Antes de pedir revisión deben pasar los comandos de `AGENTS.md` §1: `ruff check .` y `pytest tests -q` en `backend/` (con `docker compose up -d`), y `npm run lint && npm run build` en `frontend/`. Ramas, commits y CI: `CONTRIBUTING.md`.

Estas reglas detallan `AGENTS.md` (reglas críticas para IA) y no lo sustituyen.

### Plantilla para la descripción del PR

```markdown
## Qué cambia
...

## Reglas que aplican
- [ ] UX-UI.md (checklist pegado abajo)
- [ ] API.md
- [ ] FRONT-BACK.md
- [ ] CREAR-API.md
- [ ] BASE-DE-DATOS.md

## Excepciones
- Ninguna / `Excepción XX-00: motivo`

## Pruebas
- [ ] ruff check y pytest verdes (unitarias + e2e)
- [ ] npm run build y npm run lint verdes
- [ ] Probado en iPhone Safari / Android Chrome / escritorio (si hay UI)
```

## Cómo cambiar una regla

Las reglas también se cambian por PR. Explica qué regla, por qué, y actualiza el código que dependa de ella en el mismo PR. No se borran IDs: si una regla deja de aplicar se marca **(retirada)** para no romper referencias en PR antiguos.
