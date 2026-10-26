import type { ZodType } from 'zod'
import { useAuth } from '../auth/store'
import { refreshOutSchema } from '../schemas/usuario'

/** Cliente HTTP único hacia la API (FB-02). Ninguna página llama a `fetch` directamente. */
export const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000'
export const TIMEOUT_MS = 20_000
export const TIMEOUT_IA_MS = 30_000
export const MENSAJE_SESION_EXPIRADA = 'Tu sesión expiró. Inicia sesión de nuevo'

export type CodigoError =
  | 'validacion' | 'no_autenticado' | 'sin_permiso' | 'no_encontrado' | 'conflicto' | 'duplicado'
  | 'longitud_requerida' | 'demasiado_grande' | 'limite' | 'no_disponible' | 'servidor'
  | 'red' | 'timeout' | 'contrato' | 'desconocido'

/** Error de un campo de un 400 de validación: `loc` sin el prefijo `body`/`query` y unido con puntos. */
export interface ErrorCampo {
  ruta: string
  mensaje: string
  tipo?: string
}

export class ApiError extends Error {
  /** HTTP status; 0 si no hubo respuesta (red caída o timeout). */
  status: number
  codigo: CodigoError
  /** Cuerpo `detalle` (400) o el cuerpo completo; útil para depurar. */
  detalle: unknown
  /** Errores por campo (solo 400 de validación): ruta → mensaje en español. */
  campos: Record<string, string>
  /** Segundos sugeridos por `Retry-After` (429/503), si vienen. */
  reintentarEn: number | null

  constructor(status: number, codigo: CodigoError, mensaje: string, extra: { detalle?: unknown; campos?: Record<string, string>; reintentarEn?: number | null } = {}) {
    super(mensaje)
    this.name = 'ApiError'
    this.status = status
    this.codigo = codigo
    this.detalle = extra.detalle
    this.campos = extra.campos ?? {}
    this.reintentarEn = extra.reintentarEn ?? null
  }

  get mensaje(): string {
    return this.message
  }
}
export class ValidacionError extends ApiError {}
export class NoAutenticadoError extends ApiError {}
export class SinPermisoError extends ApiError {}
export class NoEncontradoError extends ApiError {}
export class ConflictoError extends ApiError {}

// ---------- traducción de errores ----------

/** Pydantic responde en inglés; el handler de main.py quita `ctx`, así que se traduce por `type`. */
const MSG_PYDANTIC: Record<string, string> = {
  missing: 'Campo obligatorio',
  string_too_short: 'Texto demasiado corto',
  string_too_long: 'Texto demasiado largo',
  string_pattern_mismatch: 'Formato inválido',
  string_type: 'Debe ser texto',
  too_short: 'Faltan elementos',
  too_long: 'Demasiados elementos',
  greater_than_equal: 'El valor es menor al mínimo',
  less_than_equal: 'El valor excede el máximo',
  greater_than: 'El valor es demasiado pequeño',
  less_than: 'El valor es demasiado grande',
  int_parsing: 'Debe ser un número entero',
  int_type: 'Debe ser un número entero',
  int_from_float: 'Debe ser un número entero',
  float_parsing: 'Debe ser un número',
  float_type: 'Debe ser un número',
  bool_parsing: 'Debe ser sí o no',
  bool_type: 'Debe ser sí o no',
  literal_error: 'Opción no válida',
  enum: 'Opción no válida',
  union_tag_invalid: 'Categoría no válida',
  union_tag_not_found: 'Falta la categoría',
  ip_any_address: 'IP inválida',
  uuid_parsing: 'Identificador inválido',
  uuid_version: 'Identificador inválido',
  extra_forbidden: 'Campo no permitido',
  value_error: 'Valor inválido',
  list_type: 'Debe ser una lista',
  json_invalid: 'JSON inválido',
}

/** Mensajes por defecto en español por código HTTP (FB-07). */
export const MENSAJES: Record<number, string> = {
  400: 'Revisa los datos enviados',
  401: MENSAJE_SESION_EXPIRADA,
  403: 'No tienes permiso para esta acción',
  404: 'No encontramos lo que buscas',
  409: 'La información cambió; actualiza e intenta de nuevo',
  411: 'El archivo o los datos son demasiado grandes',
  413: 'El archivo o los datos son demasiado grandes',
  429: 'Demasiados intentos, espera un momento',
  500: 'Ocurrió un error en el servidor; intenta más tarde',
  502: 'El servicio no está disponible por ahora',
  503: 'El servicio no está disponible por ahora',
  504: 'El servicio no está disponible por ahora',
}
const MENSAJE_RED = 'Sin conexión con el servidor. Revisa tu internet e intenta de nuevo'
const MENSAJE_TIMEOUT = 'El servidor tardó demasiado en responder. Intenta de nuevo'
const MENSAJE_CONTRATO = 'La respuesta del servidor no tiene el formato esperado'

/** Mensajes de FastAPI/slowapi en inglés o demasiado técnicos: se sustituyen por el mensaje por código. */
const NO_MOSTRAR = /^(not found|not authenticated|method not allowed|forbidden|internal server error|rate limit exceeded|unauthorized|falta el permiso)/i

function codigoPorStatus(status: number): CodigoError {
  if (status === 400 || status === 422) return 'validacion'
  if (status === 401) return 'no_autenticado'
  if (status === 403) return 'sin_permiso'
  if (status === 404) return 'no_encontrado'
  if (status === 409) return 'conflicto'
  if (status === 411) return 'longitud_requerida'
  if (status === 413) return 'demasiado_grande'
  if (status === 429) return 'limite'
  if (status === 502 || status === 503 || status === 504) return 'no_disponible'
  if (status >= 500) return 'servidor'
  return 'desconocido'
}

function claseError(status: number) {
  switch (status) {
    case 400:
    case 422:
      return ValidacionError
    case 401:
      return NoAutenticadoError
    case 403:
      return SinPermisoError
    case 404:
      return NoEncontradoError
    case 409:
      return ConflictoError
    default:
      return ApiError
  }
}

/** `Retry-After` en segundos o fecha HTTP → segundos (≥ 0), o null. */
export function leerRetryAfter(valor: string | null): number | null {
  if (!valor) return null
  const s = Number(valor)
  if (Number.isFinite(s)) return Math.max(0, Math.ceil(s))
  const fecha = Date.parse(valor)
  return Number.isNaN(fecha) ? null : Math.max(0, Math.ceil((fecha - Date.now()) / 1000))
}

interface DetalleItem {
  loc?: (string | number)[]
  msg?: string
  type?: string
}

/** `detalle` de un 400 → mapa `ruta → mensaje` (FB-08). `loc` sin `body`/`query`/`path`. */
export function camposDeDetalle(detalle: unknown): Record<string, string> {
  const campos: Record<string, string> = {}
  if (!Array.isArray(detalle)) return campos
  for (const d of detalle as DetalleItem[]) {
    if (!d || typeof d !== 'object') continue
    const loc = (d.loc ?? []).filter((p, i) => !(i === 0 && (p === 'body' || p === 'query' || p === 'path')))
    // En uniones discriminadas Pydantic agrega la etiqueta (`computo_redes`) a la ruta: se quita.
    const ruta = loc.filter((p) => !['computo_redes', 'infraestructura', 'academico'].includes(String(p))).join('.')
    const mensaje = (d.type && MSG_PYDANTIC[d.type]) || d.msg || 'Valor inválido'
    const clave = ruta || '_general'
    if (!campos[clave]) campos[clave] = mensaje
  }
  return campos
}

/** Convierte una respuesta de error de la API (cualquier forma, JSON o no) en `ApiError`. */
export function mapearError(status: number, cuerpo: unknown, cabeceras?: Headers): ApiError {
  const c = cuerpo && typeof cuerpo === 'object' ? (cuerpo as Record<string, unknown>) : null
  const reintentarEn = leerRetryAfter(cabeceras?.get('Retry-After') ?? null)
  let codigo = codigoPorStatus(status)
  if (c?.error === 'duplicado') codigo = 'duplicado'

  // Texto del servidor: `detail` (HTTPException) o `detalle` si es texto (409 duplicado).
  let texto: string | null = null
  if (typeof c?.detail === 'string') texto = c.detail
  else if (typeof c?.detalle === 'string') texto = c.detalle
  if (texto && NO_MOSTRAR.test(texto)) texto = null

  let detalle: unknown = c?.detalle ?? c?.detail ?? cuerpo
  let campos: Record<string, string> = {}
  let mensaje = texto ?? MENSAJES[status] ?? (status >= 500 ? MENSAJES[500] : `Error inesperado (${status})`)

  if (status === 400 || status === 422) {
    // FastAPI sin el handler de main.py devuelve 422 {detail: [...]}; con él, 400 {error, detalle: [...]}.
    const lista = Array.isArray(c?.detalle) ? c.detalle : Array.isArray(c?.detail) ? c.detail : null
    if (lista) {
      detalle = lista
      campos = camposDeDetalle(lista)
      const soloGeneral = Object.keys(campos).length === 1 && campos._general
      mensaje = soloGeneral ? campos._general : 'Revisa los campos marcados'
    }
  }
  if (status === 401) mensaje = texto === 'Credenciales inválidas' ? 'Correo o contraseña incorrectos' : MENSAJE_SESION_EXPIRADA
  if (status === 429 && reintentarEn) mensaje = `${mensaje} (intenta de nuevo en ${reintentarEn} s)`

  const Clase = claseError(status)
  return new Clase(status, codigo, mensaje, { detalle, campos, reintentarEn })
}

// ---------- sesión ----------

let alExpirar: (() => void) | null = null

/** main.tsx registra aquí qué hacer al expirar la sesión (p. ej. `queryClient.clear()`). */
export function configurarExpiracion(fn: () => void) {
  alExpirar = fn
}

/**
 * Sin renovación posible: cierra sesión UNA sola vez y RequirePermiso lleva a /login (FB-05).
 * Solo actúa si el token rechazado sigue siendo el vigente: varias peticiones en vuelo con 401
 * producen un solo cierre, y un 401 tardío del token anterior no cierra una sesión nueva.
 */
export function expirarSesion(tokenRechazado: string) {
  const auth = useAuth.getState()
  if (!auth.token || auth.token !== tokenRechazado) return
  auth.cerrarSesion(MENSAJE_SESION_EXPIRADA)
  alExpirar?.()
}

/** Rutas de sesión: viajan con la cookie HttpOnly de refresh y su 401 no dispara renovación. */
const RUTAS_SESION = ['/auth/login', '/auth/refresh', '/auth/logout']
const esRutaSesion = (ruta: string) => RUTAS_SESION.some((r) => ruta === r || ruta.startsWith(`${r}?`))

let refrescoEnCurso: Promise<string | null> | null = null

/**
 * POST /auth/refresh con la cookie HttpOnly (`credentials: 'include'`). Un solo refresh a la vez:
 * las peticiones que reciben 401 en paralelo comparten la misma promesa. Devuelve el nuevo
 * access token (ya guardado en memoria) o null si la cookie no existe, expiró o fue revocada.
 */
export function refrescarSesion(): Promise<string | null> {
  if (!refrescoEnCurso) {
    refrescoEnCurso = (async () => {
      try {
        const r = await api('/auth/refresh', { method: 'POST', credentials: 'include', schema: refreshOutSchema })
        useAuth.getState().actualizarToken(r.access_token)
        return r.access_token
      } catch (e) {
        if (import.meta.env.DEV) console.info('[api] no fue posible renovar la sesión', e)
        return null
      } finally {
        refrescoEnCurso = null
      }
    })()
  }
  return refrescoEnCurso
}

// ---------- petición ----------

export interface Opciones extends Omit<RequestInit, 'body'> {
  body?: BodyInit | null
  /** Se serializa como JSON y agrega `Content-Type: application/json`. */
  json?: unknown
  /** Query string; `undefined`, `null` y '' se omiten. */
  params?: Record<string, string | number | boolean | null | undefined>
  /** Timeout en ms (20 s por defecto; usa TIMEOUT_IA_MS para IA). */
  timeoutMs?: number
  /** Interno: la petición ya se reintentó tras renovar la sesión (un solo reintento). */
  reintentoSesion?: boolean
}

function construirUrl(ruta: string, params?: Opciones['params']): string {
  const url = `${BASE}${ruta}`
  if (!params) return url
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  const s = qs.toString()
  return s ? `${url}?${s}` : url
}

function leerCuerpo(texto: string, tipo: string | null): unknown {
  if (!texto) return null
  const pareceJson = tipo?.includes('json') || /^\s*[[{"]/.test(texto)
  if (!pareceJson) return texto
  try {
    return JSON.parse(texto)
  } catch {
    return texto // HTML de un proxy, texto plano, JSON truncado: nunca rompe la app
  }
}

/** Valida una respuesta con Zod; si no cumple el contrato lanza ApiError `contrato` (no pantalla blanca). */
export function validarRespuesta<S extends ZodType>(schema: S, datos: unknown, ruta = '', status = 200): S['_output'] {
  const r = schema.safeParse(datos)
  if (r.success) return r.data
  if (import.meta.env.DEV) console.error(`[api] respuesta fuera de contrato en ${ruta}`, r.error.issues)
  throw new ApiError(status, 'contrato', MENSAJE_CONTRATO, { detalle: r.error.issues })
}

export async function api<S extends ZodType>(ruta: string, init: Opciones & { schema: S }): Promise<S['_output']>
export async function api<T = unknown>(ruta: string, init?: Opciones): Promise<T>
export async function api(ruta: string, init: Opciones & { schema?: ZodType } = {}): Promise<unknown> {
  const { json, headers, params, timeoutMs = TIMEOUT_MS, schema, signal, reintentoSesion = false, ...resto } = init
  const h = new Headers(headers)
  const token = useAuth.getState().token
  if (token) h.set('Authorization', `Bearer ${token}`)
  let body = resto.body
  if (json !== undefined) {
    h.set('Content-Type', 'application/json')
    body = JSON.stringify(json)
  }
  if (!h.has('Accept')) h.set('Accept', 'application/json')

  // Timeout propio + señal del llamador (TanStack Query cancela al desmontar).
  const control = new AbortController()
  let porTimeout = false
  const reloj = setTimeout(() => {
    porTimeout = true
    control.abort()
  }, timeoutMs)
  const alCancelar = () => control.abort()
  if (signal) {
    if (signal.aborted) control.abort()
    else signal.addEventListener('abort', alCancelar, { once: true })
  }

  let resp: Response
  let texto: string
  try {
    resp = await fetch(construirUrl(ruta, params), { ...resto, headers: h, body, signal: control.signal })
    texto = await resp.text()
  } catch (e) {
    if (porTimeout) throw new ApiError(0, 'timeout', MENSAJE_TIMEOUT)
    if (signal?.aborted) throw e // cancelación del llamador: TanStack Query la maneja
    throw new ApiError(0, 'red', MENSAJE_RED, { detalle: e })
  } finally {
    clearTimeout(reloj)
    signal?.removeEventListener('abort', alCancelar)
  }

  const cuerpo = leerCuerpo(texto, resp.headers.get('Content-Type'))
  if (!resp.ok) {
    const error = mapearError(resp.status, cuerpo, resp.headers)
    // El 401 de /auth/login es "credenciales inválidas"; los de refresh/logout los maneja quien llama.
    if (resp.status === 401 && token && !esRutaSesion(ruta)) {
      if (!reintentoSesion) {
        // Otra petición ya renovó el token: basta con reintentar; si no, se renueva una sola vez.
        const vigente = useAuth.getState().token
        const nuevo = vigente && vigente !== token ? vigente : await refrescarSesion()
        if (nuevo) return api(ruta, { ...init, reintentoSesion: true })
      }
      expirarSesion(token)
    }
    throw error
  }
  return schema ? validarRespuesta(schema, cuerpo, ruta, resp.status) : cuerpo
}

/** Política de reintentos de queries (FB-11): solo red/timeout/5xx, máximo 2; nunca 4xx ni contrato. */
export function debeReintentar(fallos: number, error: unknown): boolean {
  if (fallos >= 2) return false
  if (!(error instanceof ApiError)) return true
  if (error.codigo === 'red' || error.codigo === 'timeout') return true
  if (error.codigo === 'contrato') return false
  return error.status >= 500 && error.status !== 501
}

/** Mensaje para mostrar de cualquier error. */
export function mensajeDeError(e: unknown, defecto = 'Ocurrió un error inesperado'): string {
  if (e instanceof ApiError) return e.message
  return defecto
}

/** Valida una entrada con Zod antes de enviarla; si falla lanza ValidacionError con `campos` (status 0, no hubo petición). */
export function validarEntrada<S extends ZodType>(schema: S, datos: unknown): S['_output'] {
  const r = schema.safeParse(datos)
  if (r.success) return r.data
  const campos: Record<string, string> = {}
  for (const i of r.error.issues) {
    const ruta = i.path.map(String).join('.') || '_general'
    if (!campos[ruta]) campos[ruta] = i.message
  }
  const primero = Object.values(campos)[0]
  throw new ValidacionError(0, 'validacion', primero ?? MENSAJES[400], { detalle: r.error.issues, campos })
}

/**
 * Paso 2 de evidencias (FB-14): PUT directo al bucket con la URL firmada.
 * Content-Type idéntico al firmado; Content-Length lo calcula el navegador del Blob. Nunca lleva Authorization.
 */
export async function subirArchivoFirmado(
  url: string,
  archivo: Blob,
  tipoMime: string,
  onProgreso?: (fraccion: number) => void,
  timeoutMs = 120_000,
): Promise<void> {
  const fallo = (status: number) =>
    new ApiError(
      status,
      status === 0 ? 'red' : 'servidor',
      status === 403
        ? 'El almacenamiento rechazó el archivo (la firma expiró o el archivo cambió). Intenta de nuevo'
        : status === 0
          ? MENSAJE_RED
          : 'No se pudo subir el archivo; intenta de nuevo',
    )
  if (onProgreso && typeof XMLHttpRequest !== 'undefined') {
    // XHR para reportar progreso de subida (fetch no lo expone).
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', url)
      xhr.timeout = timeoutMs
      xhr.setRequestHeader('Content-Type', tipoMime)
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgreso(e.loaded / e.total)
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(fallo(xhr.status)))
      xhr.onerror = () => reject(fallo(0))
      xhr.ontimeout = () => reject(new ApiError(0, 'timeout', MENSAJE_TIMEOUT))
      xhr.send(archivo)
    })
    onProgreso(1)
    return
  }
  let resp: Response
  try {
    resp = await fetch(url, { method: 'PUT', headers: { 'Content-Type': tipoMime }, body: archivo, signal: AbortSignal.timeout(timeoutMs) })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError') throw new ApiError(0, 'timeout', MENSAJE_TIMEOUT)
    throw fallo(0)
  }
  if (!resp.ok) throw fallo(resp.status)
}
