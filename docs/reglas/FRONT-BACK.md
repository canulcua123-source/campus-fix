# FRONT-BACK · Contrato entre la PWA y la API

Cómo habla la PWA (`frontend/src/`) con la API (`backend/app/`). Si cambias un lado del contrato, cambias el otro **en el mismo PR**.

Archivos clave: `frontend/src/api/client.ts` (`api()`, `ApiError` y subclases, `debeReintentar`, `subirArchivoFirmado`), `frontend/src/api/queryClient.ts` (`crearQueryClient`), `frontend/src/api/keys.ts` (claves de query), `frontend/src/api/hooks/` (hooks de TanStack Query), `frontend/src/api/<recurso>.ts` (llamadas + `queryOptions`), `frontend/src/api/avisos.ts` (errores globales para el Toast), `frontend/src/auth/store.ts` (`useAuth`, token en memoria), `frontend/src/auth/RequirePermiso.tsx`, `frontend/src/schemas/*.ts` (Zod de entradas y respuestas; `etiquetas.ts` con los textos de los enums), `frontend/src/main.tsx`, `frontend/vite.config.ts` (service worker), `backend/app/schemas/*.py` (Pydantic), `backend/app/main.py` (CORS y errores).

---

## 1. Conexión y cliente HTTP

**FB-01 · URL base solo por `VITE_API_URL`.** Se define en `frontend/.env` (`.env.example`: `http://localhost:8000`). Nunca escribas la URL de la API en un componente. En producción apunta al dominio HTTPS de la API.

El dominio institucional se configura como `DOMINIO_CORREO` en el backend y `VITE_DOMINIO_CORREO` en la PWA; ambos deben contener exactamente el mismo dominio, sin `@`. El valor local documentado es `utm.edu.mx` y las pruebas E2E usan explícitamente `e2e.local`.

**FB-02 · Un solo cliente: `api()` de `api/client.ts`.** Prohibido `fetch`/`axios` sueltos hacia la API en páginas o componentes. El cliente agrega el Bearer token, serializa `json` (solo entonces pone `Content-Type`), arma `params`, corta a los 20 s (`timeoutMs`; 60 s en IA), valida la respuesta con `schema` (Zod) y convierte los errores en `ApiError`. En pantallas usa los hooks de `api/hooks/` (sección 4), no `api()` directo. La **única** excepción es el `PUT` al bucket (FB-14), que también vive en `api/client.ts` como función propia.

```ts
// ✅
const inc = await api('/incidencias', { method: 'POST', json: datos, schema: incidenciaCreadaSchema })
// ✅✅ en una pantalla
const crear = useCrearIncidencia()
// ❌
const r = await fetch('http://localhost:8000/incidencias', { method: 'POST', body: JSON.stringify(datos) })
```

**FB-03 · Rutas relativas a la API, sin prefijo `/api`.** La API expone `/incidencias`, `/auth/login`, etc. en la raíz de su propio dominio.

## 2. Sesión

**FB-04 · Token solo en memoria.** El `access_token` vive en `useAuth` (Zustand) y nada más. Prohibido guardarlo en `localStorage`, `sessionStorage`, IndexedDB, cookies escritas por JS o en la URL (RNF-11; Safari borra el almacenamiento de sitios no instalados y cualquier XSS lo leería).

```ts
// ✅ useAuth.getState().iniciarSesion(r.access_token, r.usuario)
// ❌ localStorage.setItem('token', r.access_token)
```

El refresh token vive en una cookie HttpOnly que la PWA nunca lee (T-014). Solo `POST /auth/login`, `/auth/refresh` y `/auth/logout` viajan con `credentials: "include"`; el resto de la API usa únicamente `Authorization`. Al abrir la app, `restaurarSesion()` (`api/auth.ts`, llamado en `main.tsx`) hace un refresh silencioso y pide `/auth/me`; mientras corre, `useAuth().restaurando` es `true` y `RequirePermiso` espera en lugar de mandar a `/login` (T-044).

**FB-05 · 401 → renovar una vez y, si no se puede, volver a iniciar sesión.** Ante un 401 de un endpoint autenticado, `api()` llama a `refrescarSesion()` (un solo `POST /auth/refresh` compartido por todas las peticiones concurrentes) y reintenta **una vez** con el token nuevo. Si el refresh falla o el reintento vuelve a dar 401, hace: `cerrarSesion("Tu sesión expiró. Inicia sesión de nuevo")` (el aviso queda en `useAuth().aviso` y lo muestra `Login`), `queryClient.clear()` y `RequirePermiso` lleva a `/login`. Se hace **una vez, en `api/client.ts`** (`expirarSesion`, solo si el token rechazado sigue vigente: varias peticiones con 401 producen un solo cierre), no en cada pantalla. Excepción: el 401 de `POST /auth/login` significa "Credenciales inválidas" y se muestra en el formulario.

**FB-06 · Cerrar sesión limpia todo:** `useLogout()` llama a `POST /auth/logout` (revoca la cookie) y, aunque la red falle, `cerrarSesion()` + `queryClient.clear()`. Si no, el siguiente usuario en el mismo celular vería datos en caché del anterior.

## 3. Errores

**FB-07 · Mensaje por código.** El cliente crea `ValidacionError` (400), `NoAutenticadoError` (401), `SinPermisoError` (403), `NoEncontradoError` (404) y `ConflictoError` (409); todas son `ApiError` con `status`, `codigo` (`validacion`, `no_autenticado`, `sin_permiso`, `no_encontrado`, `conflicto`, `duplicado`, `demasiado_grande`, `limite`, `no_disponible`, `servidor`, `red`, `timeout`, `contrato`…), `message` en español, `campos` (400) y `reintentarEn` (`Retry-After`). Muestra siempre `e.message`. Las mutaciones publican su error en `useAvisosApi` (para el Toast global) salvo 401 y 400 con campos; `meta: { silencioso: true }` lo evita. Las pantallas muestran:

| Código | Qué muestra la PWA | Acción |
|---|---|---|
| 400 | Errores en cada campo (FB-08) | Corregir |
| 401 | "Tu sesión expiró…" | FB-05 |
| 403 | "No tienes permiso para esta acción" | Ocultar el botón la próxima vez (UX-31) |
| 404 | "No encontramos esta incidencia" (no decir "no tienes acceso") | Volver a la lista |
| 409 | El `detail` de la API ("Transición de estado no permitida", "Se alcanzó el límite de 10 evidencias") | Refrescar los datos (`invalidateQueries`) |
| 411/413 | "El archivo o los datos son demasiado grandes" | — |
| 429 | El `detail` si viene ("Alcanzaste el límite de 20 análisis por día"); si no, "Demasiados intentos, espera un momento" | No reintentar en automático |
| 503 | "El servicio no está disponible por ahora"; en IA: seguir con el formulario manual | Reintentar más tarde |
| red caída / 5xx | "Sin conexión con el servidor" + Reintentar | `refetch()` |

Los mensajes de la API llegan en `detail` (HTTPException) o en `error`/`detalle` (validación, 409 de duplicado, 413, 429 de slowapi): ver API.md API-08. Ambos se leen en `mapearError()`. Si la respuesta no es JSON (p. ej. un 502 del proxy en HTML), el cliente no debe romper con `JSON.parse`: usa un mensaje genérico.

**Mis reportes.** `MisTickets.tsx` usa `useIncidencias({ propias: true, estado })`; el estado vive en la URL (`?estado=`) y la tarjeta reutilizable es `components/TarjetaIncidencia.tsx`.

**Tablero del coordinador.** `pages/Tablero.tsx` lee `estado`, `prioridad`, `edificio` y `tecnico` de la URL y los manda a `GET /incidencias` (no filtra en cliente). El selector (`SelectorTecnico`) usa `useTecnicos(categoria)` → `GET /usuarios/tecnicos?area=` (clave `['usuarios', 'tecnicos', area]`) y `useAsignar(id)`.

**Filtro por categoría.** Con categorías dinámicas, `GET /incidencias?categoria=<clave inexistente>` responde 200 con lista vacía (estado vacío en la PWA, no error). Solo un formato inválido produce 400. Toma las claves de `useCategorias` en lugar de una lista fija.

**FB-08 · 400 de la API → `setError` en el campo.** `detalle[].loc` trae la ruta (`["body","detalle_especifico","computo_redes","vlan"]`). El cliente ya la convierte en `e.campos` (`{ 'detalle_especifico.vlan': 'El valor excede el máximo' }`: sin `body` ni la etiqueta de la unión, mensaje traducido por `type`; sin ruta → `_general`). Lo ideal es que Zod ya lo haya detectado antes (FB-12).

```ts
// ✅
catch (e) {
  if (e instanceof ValidacionError) {
    for (const [ruta, message] of Object.entries(e.campos)) {
      if (ruta === '_general') setErrorGeneral(message)
      else setError(ruta as Path<IncidenciaForm>, { message })
    }
  } else setErrorGeneral(mensajeDeError(e, 'No se pudo guardar'))
}
```

## 4. TanStack Query

**FB-09 · Lecturas con `useQuery`, escrituras con `useMutation`.** Nada de `useEffect` + `fetch` + `useState` para datos del servidor. Usa los hooks de `api/hooks/` (`useMe`, `useLogin`, `useLogout`, `useIncidencias(filtros)`, `useIncidencia(id)`, `useBuscar(q)`, `useCrearIncidencia`, `useSeguimiento(id)`, `useAsignar(id)`, `useTags(id)`, `useEvidencia(id)`, `useUrlEvidencia`, `useCategorias`, `useAnalitica`, `useAnalizarImagen`, `useUsuarios`, `useTecnicos`, `useCrearUsuario`, `useEditarUsuario`, `useRoles`, `useCrearRol`). Si falta uno, agrégalo ahí con su `queryOptions` en `api/<recurso>.ts`. Claves estándar (centralizadas en `api/keys.ts`, objeto `claves`):

| Clave | Endpoint |
|---|---|
| `['auth', 'me']` | `GET /auth/me` |
| `['incidencias', filtros]` | `GET /incidencias?...` |
| `['incidencias', 'buscar', q]` | `GET /incidencias/buscar?q=` |
| `['incidencia', id]` | `GET /incidencias/{id}` |
| `['analitica', 'edificios']`, `['analitica', 'tags']` | `GET /analitica/*` |
| `['roles']`, `['usuarios']`, `['categorias']` | catálogos de admin |

**FB-10 · Invalidar después de cada mutación** lo que la mutación cambió:

| Mutación | Invalidar |
|---|---|
| `POST /incidencias` | `['incidencias']`, `['analitica']` |
| `PATCH .../seguimiento`, `PATCH .../asignacion`, `PATCH .../prioridad` | `['incidencia', id]`, `['incidencias']`, `['analitica']` |
| `POST`/`DELETE .../tags` | `['incidencia', id]`, `['analitica', 'tags']` |
| `POST .../evidencias` | `['incidencia', id]` |
| `POST /roles`, `POST`/`PATCH /usuarios` | `['roles']` / `['usuarios']` |

```ts
// ✅
const m = useMutation({
  mutationFn: (d: SeguimientoForm) => api(`/incidencias/${id}/seguimiento`, { method: 'PATCH', json: d }),
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: ['incidencia', id] })
    qc.invalidateQueries({ queryKey: ['incidencias'] })
  },
})
```

**FB-11 · Reintentos solo en GET y nunca en 4xx.** Configurado una vez en `crearQueryClient()` (`api/queryClient.ts`, usado por `main.tsx`): `retry: debeReintentar` (máx. 2, solo red/timeout/5xx; nunca 4xx ni `contrato`), `staleTime: 30 s`, mutaciones sin reintento, `refetchOnWindowFocus` solo en listas.

```ts
// ✅ main.tsx
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: debeReintentar, // api/client.ts
      staleTime: 30_000,
    },
    mutations: { retry: false },   // un POST repetido puede duplicar una incidencia
  },
})
```

## 5. Validación espejo: Zod ⇄ Pydantic

**FB-12 · Zod es espejo de Pydantic.** Cada schema de entrada de la API tiene su equivalente en `frontend/src/schemas/` con **los mismos nombres de campo, enums, mínimos, máximos y patrones**. Cuando cambia un schema en `backend/app/schemas/` (o una clase `...In` dentro de un router), se actualiza el Zod **en el mismo PR**. Los mensajes de Zod van en español (tabla 7.2 de la documentación).

| Pydantic (`backend/app/schemas/incidencia.py`) | Zod (`frontend/src/schemas/incidencia.ts`) |
|---|---|
| `titulo: str = Field(min_length=5, max_length=120)` | `z.string().min(5, '…').max(120, '…')` |
| `vlan: int = Field(ge=1, le=4094)` | `z.number().int().min(1).max(4094)` |
| `codigo_curso: str = Field(pattern=r"^[A-Z]{2,4}-\d{3}$")` | `z.string().regex(/^[A-Z]{2,4}-\d{3}$/)` |
| `DetalleEspecifico` con `discriminator="categoria"` | `z.discriminatedUnion('categoria', [...])` |
| `Prioridad = Literal[...]` | `z.enum(PRIORIDADES)` |

```ts
// ✅ mismo límite que Ubicacion.edificio (max_length=60)
edificio: z.string().min(1, 'Indica el edificio').max(60, 'Máximo 60 caracteres'),
// ❌ sin máximo: el usuario escribe 200 caracteres y la API responde 400 sin aviso previo
edificio: z.string().min(1, 'Requerido'),
```

Zod es para avisar rápido; **la seguridad está en Pydantic y `$jsonSchema`**. Nunca relajes Pydantic "porque el front ya valida".

**FB-13 · Tipos compartidos.** Los tipos de TypeScript salen de Zod (`z.infer`) tanto para entradas como para respuestas (`incidenciaListaItemSchema`, `incidenciaDetalleSchema`, `meSchema`, `rolSchema`, `categoriaSchema`, `analiticaEdificioSchema`…). Cada hook valida la respuesta con `safeParse`; si no cumple, lanza `ApiError` `contrato` (error controlado, no pantalla blanca) y lo registra en consola en desarrollo. Mismos nombres que el JSON con los mismos nombres que el JSON (`_id`, `codigo`, `fecha_creacion`, `tecnico_asignado`). Enums una sola vez (`PRIORIDADES`, `ESTADOS`, `CATEGORIAS`) y se reutilizan en formularios y `Badge`.  (recomendado) Generar tipos desde `/openapi.json` con `openapi-typescript` para detectar desajustes.

## 6. Evidencias: flujo exacto en 3 pasos

El archivo **nunca pasa por la API**: va directo del celular al bucket (Backblaze B2, API S3) con una URL firmada. MongoDB guarda solo metadatos y la ruta (`url_storage`).

```
PWA ──1. POST /incidencias/{id}/evidencias/firma {nombre_archivo, tipo_mime, peso_bytes} ──▶ API   → 200 {evidencia_id, url_storage, upload_url, expira_en: 300}
PWA ──2. PUT upload_url  (Content-Type = tipo_mime, cuerpo = el mismo archivo de peso_bytes) ──▶ Bucket → 200
PWA ──3. POST /incidencias/{id}/evidencias {evidencia_id} ──────────────────────────────────▶ API   → 201 {ok, evidencia_id}
```

**FB-14 · Reglas del flujo:**

1. `tipo_mime` ∈ `image/jpeg`, `image/png`, `image/webp`, `application/pdf`; `peso_bytes` = **tamaño exacto del archivo que vas a subir** (`blob.size`, después de comprimir), 1 B a 10 MB; `nombre_archivo` de 1 a 120 caracteres, sin `/`, `\` ni `..`.
2. El `PUT` lleva `Content-Type` **idéntico** a `tipo_mime` y un cuerpo de exactamente `peso_bytes` bytes. Ambos están dentro de la firma: si no coinciden, el bucket responde 403. El navegador calcula `Content-Length` solo a partir del `Blob` (no se puede fijar a mano); por eso no modifiques el archivo entre el paso 1 y el 2.
3. El `PUT` **no lleva** `Authorization` (el token de la API nunca se manda al bucket).
4. La `upload_url` caduca en 5 min (`EXPIRA_SEGUNDOS = 300`) y la firma pendiente en 10 min (`FIRMA_TTL`); haz los 3 pasos seguidos. Una firma sirve una sola vez.
5. Si el paso 3 responde 400 ("La evidencia no fue firmada… o la firma expiró" / "El archivo no se subió o no coincide"), se repite desde el paso 1. 409 = límite de 10 evidencias.

Implementado en `subirEvidencia()` (`api/evidencias.ts`) + `subirArchivoFirmado()` (`api/client.ts`); valida con `evidenciaFirmaSchema` antes de pedir la firma.

```ts
// ✅ en una pantalla
const evidencia = useEvidencia(incidenciaId)
evidencia.mutate({ archivo, onProgreso: (f) => setProgreso(f) })   // firma → PUT → registro; invalida ['incidencia', id]
// ❌ mandar el archivo a la API, poner Authorization en el PUT, o comprimir después de pedir la firma
```

**FB-15 · Ver una evidencia:** `GET /incidencias/{id}/evidencias/{evidencia_id}/url` → `{url, expira_en: 300}`. Pídela **al momento de abrirla** (al tocar la miniatura o al montar el visor) y úsala de inmediato. **Nunca guardes esa URL** en estado persistente, en la base, en caché de Query con `staleTime` ≥ 5 min ni en el service worker: caduca en 5 minutos. La URL fuerza descarga (`attachment`); para miniaturas, usa la URL en `<img src>` recién pedida.

## 7. IA

**FB-16 · Análisis de foto:** `POST /ia/analizar-imagen` en `multipart/form-data` con el campo **`imagen`** (JPEG/PNG/WebP, ≤ 5 MB) y opcional **`contexto`** (texto ≤ 500 caracteres, p. ej. lo que escribió el usuario). Comprime antes en el celular (`browser-image-compression`, 1568 px, 1.5 MB, JPEG, como hace `Reportar.tsx`). Usa `api()` con `body: FormData` y **sin** `Content-Type` manual (el navegador agrega el `boundary`).

```ts
// ✅
const fd = new FormData()
fd.append('imagen', comprimida, 'incidencia.jpg')
if (contexto) fd.append('contexto', contexto.slice(0, 500))
const sugerencia = respuestaIaSchema.parse(await api('/ia/analizar-imagen', { method: 'POST', body: fd }))
// ✅✅ o con el hook (multipart, timeout 30 s; el servidor reintenta dentro de un deadline total de 28 s, respuesta validada)
const ia = useAnalizarImagen(); ia.mutate({ imagen: comprimida, contexto })
// ❌ headers: { 'Content-Type': 'multipart/form-data' }   → falta el boundary, 400
```

Respuestas: 200 `RespuestaIA { accion, motivos, analisis_id, analisis, accion_asistida, mensaje, cache }`: `accion` (`agentico`, `formulario` o `duplicado`) la deciden las compuertas G1–G9 del servidor y el cliente no puede forzarla; `accion_asistida` (`autollenar`, `sugerir`, `preguntar` o `rechazar`) indica qué autollenar (solo campos no editados con `autollenar`/`sugerir`); el frontend muestra siempre `mensaje`; `analisis` es `AnalisisImagen` con la confianza efectiva; `analisis_id` (UUID v4, 30 min, ligado al usuario) se consulta con `GET /ia/analisis/{analisis_id}`; `cache` es `true` si reutilizó un análisis sin consumir cupo; el frontend muestra siempre `mensaje` y solo autollena campos no editados con `autollenar`/`sugerir`), `analisis` es `AnalisisImagen` con la confianza efectiva y `cache` es `true` si reutilizó un análisis sin consumir cupo; 400 formato/tamaño; 429 límite diario; 503 IA apagada, sin cupo global, Redis no disponible para contabilizar el cupo (falla cerrado) o error del modelo. La respuesta se valida con `respuestaIaSchema`. En 429 y 503 se sigue con el formulario manual (RF-IA-05). La PWA nunca llama a la API de Anthropic directamente.

Al crear una incidencia, `ia_sugerencia` es opcional y solo se manda si el usuario aceptó campos sugeridos.
Su forma es `IASugerencia` (`{modo, modelo, version_prompt, confianza, campos_autollenados, accion?, …}`, sin `null`) y está reflejada por
`iaSugerenciaSchema`. Consultar `/ia/analizar-imagen` nunca persiste esa estructura por sí mismo. La
configuración administrable vive en `GET/PATCH /config/ia`; ambas rutas requieren
`configuracion:gestionar`, por lo que no se consumen desde la pantalla de reporte.

## 8. CORS, service worker y fechas

**FB-17 · CORS en dos lugares.** API: `CORS_ORIGINS` (lista separada por comas, sin `/` final) con el origen exacto de la PWA (`http://localhost:5173`, `https://<dominio-pwa>`); nunca `*`. La API usa `allow_credentials=True` exclusivamente para la cookie HttpOnly de refresh y valida `Origin` en refresh/logout; el access token sigue viajando en `Authorization`. Bucket: reglas CORS con los mismos orígenes, permitiendo `PUT` (subida) y `GET` (lectura) y el encabezado `Content-Type`. Si agregas un dominio de despliegue, actualiza **ambos** en el mismo cambio.

**FB-18 · El service worker no cachea la API ni datos autenticados.** `vite.config.ts` tiene `runtimeCaching: []` y `navigateFallbackDenylist: [/^\/api/]`: solo se precachean los archivos del build. Prohibido agregar reglas de `runtimeCaching` para `VITE_API_URL`, URLs firmadas del bucket o cualquier respuesta con `Authorization`. Lo "sin conexión" se resuelve con la caché en memoria de TanStack Query y `OfflineBanner`, no con el SW.

**FB-19 · Fechas.** La API envía y recibe instantes en ISO 8601 UTC; la PWA envía fechas con `new Date(...).toISOString()` y muestra con `Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City' })` (UX-28). Nunca mandes fechas locales sin zona (`"2026-10-19 08:00"`). Los filtros por "día" se calculan en `America/Mexico_City` y se convierten a UTC antes de mandarlos.

---

## Checklist FRONT-BACK

- [ ] Todas las llamadas pasan por `api()` de `api/client.ts`; URL base desde `VITE_API_URL`.
- [ ] Token solo en `useAuth` (memoria). Nada en `localStorage`/`sessionStorage`.
- [ ] 401 cierra sesión, limpia caché y lleva a `/login`; 403/404/409/413/429/503 con mensaje en español.
- [ ] Errores 400 mapeados a sus campos con `setError`.
- [ ] `useQuery`/`useMutation` con claves estándar; invalidación tras cada mutación.
- [ ] Sin reintentos en 4xx ni en mutaciones.
- [ ] Schema Pydantic cambiado ⇒ Zod actualizado en el mismo PR (mismos límites, enums y patrones).
- [ ] Evidencias: firma → PUT con `Content-Type` exacto y el mismo archivo → registro (201). Sin `Authorization` en el PUT.
- [ ] URL de lectura pedida al abrir y nunca guardada.
- [ ] IA: multipart con `imagen` (+ `contexto`), sin `Content-Type` manual; fallo ⇒ formulario manual.
- [ ] Orígenes nuevos agregados a `CORS_ORIGINS` y al CORS del bucket.
- [ ] Ninguna regla nueva de caché del service worker para la API o el bucket.
- [ ] Fechas en UTC hacia la API; mostradas en es-MX / America/Mexico_City.
