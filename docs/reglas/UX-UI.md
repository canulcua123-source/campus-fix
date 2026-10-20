# UX/UI · Reglas de la PWA

Objetivo: que UTM Desk se sienta como app nativa en iPhone y Android, y como aplicación de escritorio en computadora, con un solo código. Base: sección 6 y 7 de la documentación del proyecto, RNF-05 a RNF-10 y el mockup `docs/mockup-pwa.html` (ábrelo en el navegador antes de diseñar una pantalla nueva: ahí están "Mis reportes", "Nuevo reporte", "Detalle", "Bandeja" y "Dashboard").

Archivos clave: `frontend/src/styles/tokens.css` (tokens), `frontend/src/index.css` (utilidades Tailwind y clases base `.card`, `.btn`, `.etiqueta`, `.campo-error`, `.tabbar`, `.topbar`), `frontend/src/lib/platform.ts` (pone `data-platform="ios|android|desktop"` en `<html>`), `frontend/src/components/AppShell.tsx` (barra inferior + sidebar), `frontend/src/components/Badge.tsx`.

---

## 1. Aspecto nativo

**UX-01 · Fuente del sistema.** Solo `var(--font-sans)` (San Francisco en iOS, Roboto en Android, Segoe en Windows). Prohibido importar fuentes web.

```css
/* ✅ */ body { font-family: var(--font-sans); }
/* ❌ */ @import url('https://fonts.googleapis.com/css2?family=Inter');
```

**UX-02 · Zonas seguras.** Nada puede quedar bajo el notch, la isla dinámica ni la barra de gestos. `index.html` ya tiene `viewport-fit=cover`; usa los tokens `--safe-top|right|bottom|left`. Todo elemento `fixed` pegado a un borde suma su safe area.

```tsx
// ✅ (así lo hace UpdatePrompt.tsx)
<div className="fixed inset-x-4" style={{ bottom: 'calc(90px + var(--safe-bottom))' }} />
// ❌ queda tapado por la barra de gestos del iPhone
<div className="fixed bottom-4 inset-x-4" />
```

**UX-03 · Navegación por tamaño.** Menos de 1024 px: barra inferior (`.tabbar`) con "Reportar" como botón central. 1024 px o más: sidebar (`<aside>` en `AppShell.tsx`, clase `lg:block`) y la barra inferior se oculta. No crees otra navegación: agrega la ruta a `IZQUIERDA`, `DERECHA` o `ADMIN` en `AppShell.tsx` con su `permiso`. Máximo 5 elementos en la barra inferior.

**UX-04 · Ajustes por plataforma solo con `data-platform`.** iOS: título grande 34 px (`.titulo-pagina`), barra translúcida con `backdrop-filter`. Android: `.topbar` sólida elevada y botón Reportar tipo FAB. Escribe estilos con el selector `:root[data-platform='ios'] ...`; nunca detectes el navegador dentro de un componente.

```css
/* ✅ */ :root[data-platform='android'] .mi-hoja { border-radius: 28px 28px 0 0; }
```
```tsx
// ❌
if (/iPhone/.test(navigator.userAgent)) { ... }
```

**UX-05 · Zonas táctiles ≥ 44 × 44 px.** Usa `min-h-11` (44 px) o `var(--tap-min)`. Íconos pequeños se envuelven en un botón de 44 px. Separación mínima de 8 px entre objetivos táctiles.

```tsx
// ✅
<button className="flex min-h-11 min-w-11 items-center justify-center" aria-label="Cerrar"><X size={20} aria-hidden /></button>
// ❌ 20 px de área táctil
<X size={20} onClick={cerrar} />
```

**UX-06 · Inputs de 16 px o más.** Evita el zoom automático de iOS. `index.css` ya lo fija para `input, select, textarea`; no lo sobrescribas con `text-sm`/`text-xs`.

**UX-07 · Sin zoom, rebote ni resaltado de navegador.** No quites `overscroll-behavior: none`, `-webkit-tap-highlight-color: transparent` ni `touch-action: manipulation` de `index.css`. Prohibido `user-scalable=no`/`maximum-scale=1` en el viewport (rompe accesibilidad). El cromo de navegación lleva `.nav-chrome` (no seleccionable); el contenido sí debe poder seleccionarse.

**UX-08 · Respuesta táctil y transiciones.** Todo botón tiene estado `:active` (recomendado `active:scale-[0.97]`). Transiciones de 150–250 ms con `transform`/`opacity` (nunca animar `width`, `height`, `top`). Cambios de pantalla con View Transitions API cuando exista (`document.startViewTransition`), con alternativa sin animación.

**UX-09 · Hojas inferiores en móvil.** Menús de acciones y selectores secundarios se abren como hoja inferior con asa y safe area abajo; en escritorio, como diálogo o menú. No uses `alert()`/`confirm()` del navegador.

## 2. Tokens y color

**UX-10 · Prohibidos los colores sueltos.** Todo color sale de `tokens.css`, ya sea con las utilidades Tailwind de `@theme inline` (`bg-brand`, `text-on-brand`, `bg-canvas`, `bg-panel`, `bg-panel-2`, `border-line`, `text-ink`, `text-muted`, `bg-ok`, `bg-warn`, `bg-bad`, `text-note`) o con `var(--token)`. Prohibido: hex, `rgb()` con valores fijos y la paleta de Tailwind (`bg-blue-600`, `text-gray-500`).

```tsx
// ✅
<p className="text-muted">Sin incidencias</p>
<div style={{ borderColor: 'var(--color-border)' }} />
// ❌
<p className="text-gray-500">Sin incidencias</p>
<div style={{ color: '#64748b' }} />
```

Únicas excepciones (no aceptan variables CSS): `theme_color`/`background_color` del manifest en `vite.config.ts` y los `<meta name="theme-color">` de `index.html`. Si cambias `--color-primary` o `--color-bg`, actualízalos en el mismo PR. Sombras `rgb(0 0 0 / x)` se permiten solo en `index.css`.

**UX-11 · Token nuevo = en claro y oscuro.** Un token se agrega en `:root`, en el bloque `@media (prefers-color-scheme: dark)` y en `:root[data-theme='dark']` de `tokens.css`; si se usará como utilidad, también en `@theme inline` de `index.css`. Nombres en español y por significado (`--color-danger`), no por apariencia (`--rojo`).

**UX-12 · Color con significado + texto.** Estado, prioridad y categoría se muestran **siempre** con `<Badge tipo valor />`, que usa `--estado-*`, `--prioridad-*`, `--categoria-*` y el texto legible de `ETIQUETAS`. El color nunca es la única señal (daltonismo). Un valor nuevo de enum = token nuevo + etiqueta en `Badge.tsx`.

```tsx
// ✅
<Badge tipo="prioridad" valor="critica" />   // muestra "Crítica"
// ❌ solo un punto rojo, o el valor crudo "critica"
<span className="h-2 w-2 rounded-full bg-bad" />
```

**UX-13 · Modo oscuro.** Toda pantalla se revisa en claro y en oscuro. Se respeta `prefers-color-scheme` y se puede forzar con `data-theme="light|dark"` en `<html>` (RF-GEN-05). Imágenes y gráficas (Recharts) toman colores de tokens, no fijos.

## 3. Estados obligatorios de cada pantalla

**UX-14 · Toda pantalla que pide datos tiene 4 estados** y los cuatro se programan y se prueban:

| Estado | Cómo se ve |
|---|---|
| Cargando | Skeleton con la forma del contenido (bloques `bg-panel-2` con `animate-pulse`). Nunca pantalla en blanco ni spinner a pantalla completa. |
| Vacío | Texto que explica + acción siguiente ("Aún no tienes reportes" + botón Reportar). |
| Error | Mensaje en español según el código (ver FRONT-BACK.md FB-07) + botón **Reintentar** (`refetch()`). |
| Sin conexión | `OfflineBanner` ya avisa arriba; la pantalla conserva lo último mostrado y deshabilita acciones que escriben. |

```tsx
// ✅
const q = useQuery({ queryKey: ['incidencias', filtros], queryFn: () => api<Incidencia[]>(`/incidencias?${params}`) })
if (q.isPending) return <ListaSkeleton />
if (q.isError) return <ErrorConReintento error={q.error} onReintentar={() => q.refetch()} />
if (q.data.length === 0) return <Vacio texto="Aún no tienes reportes" accion={<Link to="/reportar">Reportar</Link>} />
return <Lista items={q.data} />
// ❌ solo el caso feliz
const { data } = useQuery(...); return data?.map(...)
```

## 4. Formularios

Base: React Hook Form + `zodResolver` + schemas de `frontend/src/schemas/`. Sección 7.1 de la documentación.

**UX-15 · Validar al salir del campo.** `useForm({ mode: 'onTouched', resolver: zodResolver(schema) })`: el error aparece al salir del campo, no mientras se escribe, y desaparece al corregirlo.

**UX-16 · Mensaje bajo el campo.** Cada campo tiene su `<p className="campo-error">` justo debajo, con texto claro en español (el de la tabla 7.2: "La VLAN debe estar entre 1 y 4094"). El input lleva `aria-invalid` y `aria-describedby` apuntando al mensaje.

```tsx
// ✅
<label className="etiqueta" htmlFor="vlan">VLAN</label>
<input id="vlan" inputMode="numeric" aria-invalid={!!err} aria-describedby="vlan-error" {...register('detalle_especifico.vlan', { valueAsNumber: true })} />
{err && <p id="vlan-error" className="campo-error">{err.message}</p>}
// ❌ un solo mensaje general arriba del formulario: "Datos inválidos"
```

**UX-17 · Botón deshabilitado al enviar.** `disabled={isSubmitting}` y texto de progreso ("Enviando…"). Evita reportes duplicados.

**UX-18 · Errores 400 de la API van a los campos.** La API responde `{"error":"validacion","detalle":[{"loc":["body","titulo"],"msg":...}]}`. Convierte `loc` (sin `"body"`) en ruta del formulario y usa `setError`. Lo que no corresponda a un campo va en un mensaje general con `role="alert"`. Ver FRONT-BACK.md FB-08.

**UX-19 · Teclado correcto.** `inputMode="numeric"` para enteros (VLAN, piso, equipos), `inputMode="decimal"` para IP y horas, `type="email"` + `autoComplete="username"` en correo, `autoComplete="current-password"` en contraseña.

**UX-20 · Opciones con texto legible.** Los `<option>` muestran texto en español ("Crítica", "Climatización"), nunca el valor crudo del enum (`critica`, `climatizacion`). El `value` sí es el valor de la API.

## 5. Accesibilidad (WCAG 2.1 AA, RNF-08)

**UX-21 · Contraste 4.5:1** para texto normal y 3:1 para texto ≥ 18.66 px negrita o íconos. Compruébalo con DevTools (Lighthouse Accesibilidad ≥ 90). Ojo: varios tokens de significado (ámbar `--estado-en-proceso`, `--color-warning`) no llegan a 4.5:1 sobre blanco; no los uses como color de texto pequeño sin oscurecerlos.

**UX-22 · Todo input tiene `<label>`** asociado con `htmlFor`/`id` (o envolviendo el input). El `placeholder` es ejemplo, no etiqueta.

**UX-23 · Botones de solo ícono llevan `aria-label`**, y el ícono `aria-hidden` (como el botón Reportar de `AppShell.tsx`).

```tsx
// ✅ <button aria-label="Quitar tag wifi"><X aria-hidden /></button>
// ❌ <button><X /></button>
```

**UX-24 · Foco visible.** Nunca `outline: none` sin reemplazo. Usa `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand`. El orden de tabulación sigue el orden visual.

**UX-25 · Movimiento reducido.** `index.css` ya anula animaciones con `prefers-reduced-motion: reduce`; no lo evites con `!important` propios. Animaciones de JS (View Transitions, Recharts) se desactivan si `matchMedia('(prefers-reduced-motion: reduce)').matches`.

**UX-26 · Avisos dinámicos con rol ARIA.** Mensajes que aparecen solos: `role="status"` (informativo) o `role="alert"` (error), como en `OfflineBanner.tsx` y `UpdatePrompt.tsx`.

## 6. Textos, fechas y flujo

**UX-27 · Todo en español claro** (RNF-07): textos, `aria-label`, mensajes de error, `alt`. Tuteo, frases cortas, sin jerga técnica para el reportante ("No tienes permiso para esta acción", no "403 Forbidden").

**UX-28 · Fechas en es-MX y zona America/Mexico_City.** La API manda ISO 8601 en UTC; la PWA siempre formatea con `Intl` y zona explícita (no dependas de la zona del dispositivo). Centraliza en un helper (`frontend/src/lib/fechas.ts`, recomendado).

```ts
// ✅
const fmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City' })
fmt.format(new Date(incidencia.fecha_creacion))   // "19 oct 2026, 8:02"
// ❌
new Date(x).toLocaleString()      // zona y formato del dispositivo
x.slice(0, 10)                    // fecha UTC: puede ser "mañana" en México
```

**UX-29 · Reportar en 3 pasos o menos** (RNF-05, sección 6.6): 1) foto (o "Llenar sin foto"), 2) revisar el formulario prellenado, 3) enviar y ver el folio (`codigo` de la respuesta 201). No agregues pasos intermedios ni pantallas de confirmación extra.

**UX-30 · IA: sugerencias marcadas y siempre editables** (RF-IA-02, RF-IA-05). Cada campo llenado por la IA lleva la marca "Sugerido por IA · NN %" (`Sparkles` + `confianza`), sigue siendo editable y la marca desaparece cuando el usuario lo modifica. Si la IA falla, está apagada (503) o `es_incidencia_valida` es `false`, se muestra un aviso y el formulario manual sigue funcionando. Nunca se envía la incidencia automáticamente.

**UX-31 · Mostrar solo lo que el rol permite** (RF-GEN-03): botones y pestañas se condicionan con `useAuth().tiene('permiso')`; rutas con `<RequirePermiso permiso="...">`. Esto es comodidad visual: la seguridad real está en la API.

---

## Checklist de revisión visual

Probar en los tres entornos. Para el celular usa el despliegue o un túnel HTTPS (`npm run dev -- --host` + Cloudflare Tunnel), instalando la PWA en la pantalla de inicio.

### iPhone · Safari (iOS 16.4+)
- [ ] Instalada: abre sin barra de Safari; nada queda bajo el notch/isla ni bajo la barra de gestos.
- [ ] Título grande de 34 px; barra inferior translúcida con desenfoque.
- [ ] Al tocar un input no hay zoom; el teclado correcto aparece (numérico, decimal, correo).
- [ ] Sin rebote al hacer scroll más allá del borde; sin resaltado azul al tocar.
- [ ] Cámara: "Tomar foto" abre la cámara trasera; una foto HEIC llega como JPEG.
- [ ] Sin instalar: aparece la instrucción "Compartir → Agregar a inicio".

### Android · Chrome (110+)
- [ ] Barra superior sólida elevada; botón Reportar con forma de FAB.
- [ ] El botón "Instalar" (beforeinstallprompt) funciona.
- [ ] Botón atrás del sistema regresa a la pantalla anterior (no cierra la app).
- [ ] Ícono maskable se ve bien en el lanzador.

### Escritorio (Chrome, Edge, Safari, Firefox)
- [ ] ≥ 1024 px: sidebar visible, barra inferior oculta, contenido máx. 960 px centrado.
- [ ] Todo se puede usar solo con teclado; el foco siempre es visible.
- [ ] Tablas/gráficas legibles; nada se estira a todo el ancho de un monitor grande.

### En los tres
- [ ] Claro y oscuro revisados; ningún color fijo (búsqueda de `#` y `bg-gray-`/`text-blue-` en el diff = 0).
- [ ] Estados de carga (skeleton), vacío, error con Reintentar y sin conexión (modo avión) revisados.
- [ ] Badges de estado/prioridad/categoría con texto, no solo color.
- [ ] Zonas táctiles ≥ 44 px; contraste ≥ 4.5:1 (Lighthouse Accesibilidad ≥ 90).
- [ ] Formularios: error al salir del campo, bajo el campo; botón deshabilitado al enviar; un 400 de la API marca el campo correcto.
- [ ] Fechas en es-MX y zona America/Mexico_City.
- [ ] Textos en español, sin valores crudos de enum (`en_proceso`, `critica`).
- [ ] Con "reducir movimiento" activado no hay animaciones.
- [ ] Reportar con foto en ≤ 3 pasos; campos de IA marcados y editables.
