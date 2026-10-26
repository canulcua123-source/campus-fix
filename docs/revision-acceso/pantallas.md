# T-071 · Revisión de acceso 4: pantallas, rutas y acciones por rol

Fecha de revisión: 26 de octubre de 2026.

Fuente: sección «Pantallas por rol» de `docs/TAREAS.md` (documento de requerimientos §6.5) y
la tabla 3.3 de permisos (`docs/revision-acceso/roles.md`). Código revisado: `frontend/src/App.tsx`,
`frontend/src/components/navegacion.ts`, `frontend/src/components/AppShell.tsx` y
`frontend/src/auth/RequirePermiso.tsx`.

## Cómo se aplica en el código

- `ACCESO_RUTA` (`components/navegacion.ts`) es la matriz ruta → `{permiso, rol}` como datos.
  `App.tsx` protege cada ruta con `<RequirePermiso {...ACCESO_RUTA[ruta]}>` y las pestañas del menú
  toman su permiso de la misma tabla: guarda y menú no pueden divergir.
- `NAVEGACION` define las pestañas por perfil (celular y escritorio). El perfil se deduce de los
  permisos y cada pestaña se filtra además por su propio acceso (UX-31).
- `RequirePermiso`: sin sesión → `/login` conservando el destino; mientras se restaura la sesión →
  indicador de carga; sin permiso o rol → pantalla **«Sin acceso»** (nunca en blanco).
- `SiPermiso` / `usePermiso`: misma regla para botones y acciones dentro de una pantalla.
- Rutas de la matriz que aún no tienen pantalla (`/tablero`, `/tecnicos`, `/reportes`,
  `/admin/edificios`, `/admin/auditoria`, `/admin/configuracion`) caen en `SeccionNoDisponible`:
  respeta el permiso («Sin acceso») y si se tiene muestra «Sección en preparación». Una ruta fuera de
  la matriz muestra «Página no encontrada».
- La seguridad real está en la API (`require_permiso`, `filtro_alcance`); el frontend solo evita
  mostrar lo que el rol no puede usar.

## Ruta × rol

✔ permitido · — bloqueado («Sin acceso» si se abre por URL).

| Ruta | Acceso | REP | TEC | COO | DIR | ADM | Pantalla |
|---|---|---|---|---|---|---|---|
| `/`, `/perfil` | sesión | ✔ | ✔ | ✔ | ✔ | ✔ | Inicio, Perfil (cerrar sesión) |
| `/reportar` | `incidencias:crear` | ✔ | ✔ | ✔ | — | ✔ | Reportar |
| `/mis-reportes` | `incidencias:ver` | ✔ | ✔ | ✔ | ✔ ¹ | ✔ | Mis reportes (`/mis-tickets` redirige) |
| `/incidencias/:id` | `incidencias:ver` | ✔ | ✔ | ✔ | ✔ | ✔ | Detalle |
| `/bandeja` | `seguimiento:registrar` | — | ✔ | ✔ | — | ✔ | Bandeja |
| `/buscar` | `incidencias:buscar` | — | ✔ | ✔ | ✔ | ✔ | Buscar / Incidencias |
| `/tablero`, `/tecnicos` | `incidencias:asignar` | — | — | ✔ | — | ✔ | pendiente (T-054) |
| `/dashboard`, `/reportes` | `analitica:ver` | — | — | ✔ | ✔ | ✔ | Dashboard / Métricas; Reportes pendiente |
| `/admin/usuarios` | `usuarios:gestionar` | — | — | — | — | ✔ | Usuarios |
| `/admin/roles` | `roles:gestionar` | — | — | — | — | ✔ | Roles (GET/POST/PATCH/DELETE `/roles`) |
| `/admin/categorias` | `categorias:gestionar` | — | — | — | — | ✔ | Categorías |
| `/admin/edificios`, `/admin/auditoria` | `usuarios:gestionar` ² | — | — | — | — | ✔ | pendiente |
| `/admin/configuracion` | `configuracion:gestionar` | — | — | — | — | ✔ | pendiente |
| `/admin/metricas-ia` | `analitica:ver` + rol `admin` | — | — | — | — | ✔ | Métricas IA (igual que `require_admin`) |

¹ La matriz no lista «Mis reportes» para el directivo y no aparece en su menú; la ruta exige
`incidencias:ver` (permiso de la tabla) y, como el directivo no puede crear incidencias, la lista
sale vacía. ² Mismo permiso que `GET /auditoria` en la API; la tabla solo dice «admin».

## Pestañas por rol

| Rol | Celular (≤ 5, UX-03) | Menú lateral (≥ 1024 px) |
|---|---|---|
| Reportante | Inicio · **Reportar** · Mis reportes · Perfil | Inicio, Mis reportes |
| Técnico | Bandeja · Buscar · **Reportar** · Perfil | Bandeja, Buscar, Mis reportes |
| Coordinador | Tablero · Bandeja · **Reportar** · Métricas · Perfil | Tablero, Incidencias, Técnicos, Métricas |
| Directivo | Dashboard · Buscar · Perfil | Dashboard, Incidencias, Reportes |
| Admin | Usuarios · Roles · Categorías · Perfil | Usuarios, Roles, Categorías, Edificios, Auditoría, Configuración, Métricas IA |

Diferencias con la tabla original, justificadas: para reportante y técnico la tabla no define menú
lateral; se usan sus pestañas sin Reportar/Perfil (que van aparte en el lateral) y el técnico conserva
«Mis reportes» porque también reporta. «Métricas IA» (T-030) se añade al final del lateral del admin.
En escritorio Perfil y «Salir» van al pie del menú lateral.

## Acciones × rol

| Acción | Guarda en la PWA | Permiso API | REP | TEC | COO | DIR | ADM |
|---|---|---|---|---|---|---|---|
| Subir evidencia | `incidencias:crear`/detalle | `evidencias:subir` | ✔ | ✔ | ✔ | — | ✔ |
| Registrar seguimiento | `puedeRegistrar` en detalle | `seguimiento:registrar` | — | ✔ | ✔ | — | ✔ |
| Cerrar incidencia | `puedeCerrar` en detalle | `seguimiento:registrar` + `incidencias:asignar` | — | — | ✔ | — | ✔ |
| Etiquetas | `EditorTags` | `tags:gestionar` | — | ✔ | ✔ | — | ✔ |
| Crear/editar/eliminar rol | `SiPermiso roles:gestionar` + `puedeOtorgar` | `roles:gestionar` | — | — | — | — | ✔ |

En la pantalla de roles, los roles del sistema son de solo lectura (la API responde 409) y no se
ofrecen acciones sobre roles con permisos o alcance mayores a los del actor (`puedeOtorgar`, espejo
de `puede_otorgar`; la API responde 403).

## Pruebas

- `components/navegacion.test.ts`: pestañas por rol igual a la matriz (5 roles), cada pestaña con el
  acceso de su ruta y ruta × rol de la tabla anterior.
- `auth/__tests__/RequirePermiso.test.tsx`: «bloquea ruta por url» renderiza `App` en cada ruta
  prohibida de cada rol base y espera «Sin acceso»; `SiPermiso` oculta acciones.
- `pages/__tests__/AdminRoles.test.tsx`: listado, alta, edición parcial, 409 al eliminar y acciones
  ocultas para roles no otorgables.
