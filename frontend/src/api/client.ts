import { useAuth } from '../auth/store'

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export class ApiError extends Error {
  status: number
  detalle: unknown
  constructor(status: number, message: string, detalle?: unknown) {
    super(message)
    this.status = status
    this.detalle = detalle
  }
}
export class ValidacionError extends ApiError {}
export class NoAutenticadoError extends ApiError {}
export class SinPermisoError extends ApiError {}
export class ConflictoError extends ApiError {}

function mapear(status: number, cuerpo: unknown): ApiError {
  const c = cuerpo as { detail?: string; detalle?: unknown } | null
  const msg = c?.detail ?? `Error ${status}`
  switch (status) {
    case 400:
      return new ValidacionError(400, 'Datos inválidos', c?.detalle)
    case 401:
      return new NoAutenticadoError(401, 'Sesión expirada o credenciales inválidas')
    case 403:
      return new SinPermisoError(403, 'No tienes permiso para esta acción')
    case 409:
      return new ConflictoError(409, msg)
    default:
      return new ApiError(status, msg, cuerpo)
  }
}

export async function api<T>(ruta: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...resto } = init
  const h = new Headers(headers)
  const token = useAuth.getState().token
  if (token) h.set('Authorization', `Bearer ${token}`)
  let body = resto.body
  if (json !== undefined) {
    h.set('Content-Type', 'application/json')
    body = JSON.stringify(json)
  }
  const resp = await fetch(`${BASE}${ruta}`, { ...resto, headers: h, body })
  const texto = await resp.text()
  const cuerpo = texto ? JSON.parse(texto) : null
  if (!resp.ok) throw mapear(resp.status, cuerpo)
  return cuerpo as T
}
