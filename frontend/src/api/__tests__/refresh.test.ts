import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '../../auth/store'
import { restaurarSesion } from '../auth'
import { ApiError, api, MENSAJE_SESION_EXPIRADA, refrescarSesion, TIMEOUT_REFRESH_MS } from '../client'
import { respuesta, simularFetch } from './utilidades'

const usuario = { nombre: 'Ana', rol: 'tecnico', permisos: ['incidencias:ver'], alcance: 'area' as const }
const tokenNuevo = () => respuesta(200, { access_token: 'nuevo', token_type: 'bearer' })
const perfil = () => respuesta(200, { _id: 'u1', correo: 'ana@utm.edu.mx', ...usuario })
const caida = () => {
  throw new TypeError('Failed to fetch')
}

beforeEach(() => {
  useAuth.setState({ token: null, usuario: null, aviso: null, restaurando: false })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('refresh con arranque en frío (B)', () => {
  it('reintenta tras 503 y red caída hasta obtener el token', async () => {
    vi.useFakeTimers()
    const f = simularFetch(() => respuesta(503, 'Service Unavailable'), caida, tokenNuevo)
    const p = refrescarSesion()
    await vi.advanceTimersByTimeAsync(5_000)
    await expect(p).resolves.toBe('nuevo')
    expect(f).toHaveBeenCalledTimes(3)
    expect(useAuth.getState().token).toBe('nuevo')
  })

  it('401 de refresh devuelve null sin reintentar', async () => {
    const f = simularFetch(() => respuesta(401, { detail: 'Sesión inválida o expirada' }))
    await expect(refrescarSesion()).resolves.toBeNull()
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('agotados los intentos por red LANZA el error (no es sesión inválida)', async () => {
    vi.useFakeTimers()
    const f = simularFetch(caida)
    const p = refrescarSesion().catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(10_000)
    const e = await p
    expect(e).toBeInstanceOf(ApiError)
    expect((e as ApiError).codigo).toBe('red')
    expect(f).toHaveBeenCalledTimes(3)
  })

  it('/auth/refresh usa un timeout mayor que el general', async () => {
    vi.useFakeTimers()
    let senal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => {
      senal = init.signal ?? undefined
      return new Promise((_, rej) => senal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))
    }))
    const p = refrescarSesion().catch(() => null)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(senal?.aborted).toBe(false) // 20 s generales ya pasaron; el refresh sigue esperando
    await vi.advanceTimersByTimeAsync(TIMEOUT_REFRESH_MS)
    expect(senal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(60_000)
    await p
  })

  it('un 401 de la API con refresh caído por red no cierra la sesión', async () => {
    vi.useFakeTimers()
    useAuth.setState({ token: 'viejo', usuario })
    simularFetch(() => respuesta(401, { detail: 'Token inválido o expirado' }), caida)
    const p = api('/incidencias').catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(10_000)
    const e = (await p) as ApiError
    expect(e.codigo).toBe('red')
    expect(useAuth.getState()).toMatchObject({ token: 'viejo', usuario, aviso: null })
  })

  it('restaurarSesion mantiene `restaurando` durante los reintentos y luego entra', async () => {
    vi.useFakeTimers()
    simularFetch(() => respuesta(502, 'Bad Gateway'), tokenNuevo, perfil)
    const p = restaurarSesion()
    expect(useAuth.getState().restaurando).toBe(true)
    await vi.advanceTimersByTimeAsync(500)
    expect(useAuth.getState().restaurando).toBe(true)
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(p).resolves.toBe(true)
    expect(useAuth.getState()).toMatchObject({ token: 'nuevo', usuario, restaurando: false })
  })

  it('restaurarSesion sin servidor avisa de conexión, no de sesión expirada', async () => {
    vi.useFakeTimers()
    simularFetch(caida)
    const p = restaurarSesion()
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(p).resolves.toBe(false)
    const { aviso, restaurando } = useAuth.getState()
    expect(restaurando).toBe(false)
    expect(aviso).toMatch(/Sin conexión/)
    expect(aviso).not.toBe(MENSAJE_SESION_EXPIRADA)
  })
})

describe('refresh entre pestañas (C)', () => {
  it('usa navigator.locks con el nombre utm-desk-refresh', async () => {
    const request = vi.fn((_n: string, fn: () => Promise<unknown>) => fn())
    vi.stubGlobal('navigator', { locks: { request } })
    simularFetch(tokenNuevo)
    await expect(refrescarSesion()).resolves.toBe('nuevo')
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0]).toBe('utm-desk-refresh')
  })

  it('sin Web Locks renueva directo', async () => {
    vi.stubGlobal('navigator', {})
    const f = simularFetch(tokenNuevo)
    await expect(refrescarSesion()).resolves.toBe('nuevo')
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('espera a que la otra pestaña suelte el candado antes de renovar', async () => {
    if (!globalThis.navigator?.locks) return // entorno sin Web Locks: cubierto por la prueba anterior
    const f = simularFetch(tokenNuevo)
    let soltar!: () => void
    const ocupado = new Promise<void>((r) => (soltar = r))
    let tomado!: () => void
    const listo = new Promise<void>((r) => (tomado = r))
    const otraPestana = navigator.locks.request('utm-desk-refresh', () => {
      tomado()
      return ocupado
    })
    await listo
    const p = refrescarSesion()
    await new Promise((r) => setTimeout(r, 20))
    expect(f).not.toHaveBeenCalled()
    soltar()
    await otraPestana
    await expect(p).resolves.toBe('nuevo')
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('peticiones en paralelo de la misma pestaña comparten un solo refresh', async () => {
    const f = simularFetch(tokenNuevo)
    const [a, b] = await Promise.all([refrescarSesion(), refrescarSesion()])
    expect(a).toBe('nuevo')
    expect(b).toBe('nuevo')
    expect(f).toHaveBeenCalledTimes(1)
  })
})
