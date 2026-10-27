// @vitest-environment jsdom
import '../../test/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useAuth } from '../../auth/store'
import { servidor } from '../../test/msw/server'
import { restaurarSesion } from '../auth'
import { api, BASE, MENSAJE_SESION_EXPIRADA, NoAutenticadoError } from '../client'
import { useLogin, useLogout } from '../hooks/auth'
import { crearQueryClient } from '../queryClient'

const usuario = { nombre: 'Ana', rol: 'tecnico', permisos: ['incidencias:ver'], alcance: 'area' as const }
const rechazar = () => HttpResponse.json({ detail: 'Token inválido o expirado' }, { status: 401 })

/** /incidencias responde 401 salvo con el token renovado. */
function apiConTokenNuevo() {
  servidor.use(
    http.get(`${BASE}/incidencias`, ({ request }) =>
      request.headers.get('Authorization') === 'Bearer nuevo' ? HttpResponse.json([]) : rechazar()),
  )
}

function envoltorio(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('auth', () => {
  it('refresca y reintenta en 401', async () => {
    useAuth.setState({ token: 'viejo', usuario })
    let credenciales: RequestCredentials | undefined
    servidor.use(http.post(`${BASE}/auth/refresh`, ({ request }) => {
      credenciales = request.credentials
      return HttpResponse.json({ access_token: 'nuevo', token_type: 'bearer' })
    }))
    apiConTokenNuevo()
    await expect(api('/incidencias')).resolves.toEqual([])
    expect(useAuth.getState().token).toBe('nuevo')
    expect(useAuth.getState().usuario).toEqual(usuario)
    expect(credenciales).toBe('include')
  })

  it('un solo refresh concurrente', async () => {
    useAuth.setState({ token: 'viejo', usuario })
    const refresh = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20))
      return HttpResponse.json({ access_token: 'nuevo', token_type: 'bearer' })
    })
    servidor.use(http.post(`${BASE}/auth/refresh`, refresh))
    apiConTokenNuevo()
    const r = await Promise.all([api('/incidencias'), api('/incidencias'), api('/incidencias')])
    expect(r).toEqual([[], [], []])
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('redirige a login si refresh falla', async () => {
    const qc = crearQueryClient()
    const clear = vi.spyOn(qc, 'clear')
    useAuth.setState({ token: 'viejo', usuario })
    servidor.use(
      http.post(`${BASE}/auth/refresh`, () => HttpResponse.json({ detail: 'Sesión inválida o expirada' }, { status: 401 })),
      http.get(`${BASE}/incidencias`, rechazar),
    )
    const [a, b] = await Promise.allSettled([api('/incidencias'), api('/incidencias')])
    expect(a.status === 'rejected' && a.reason).toBeInstanceOf(NoAutenticadoError)
    expect(b.status).toBe('rejected')
    // Sin usuario, RequirePermiso manda a /login con el aviso de sesión expirada.
    expect(useAuth.getState().token).toBeNull()
    expect(useAuth.getState().usuario).toBeNull()
    expect(useAuth.getState().aviso).toBe(MENSAJE_SESION_EXPIRADA)
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('no reintenta más de una vez si el token renovado también es rechazado', async () => {
    useAuth.setState({ token: 'viejo', usuario })
    servidor.use(http.post(`${BASE}/auth/refresh`, () => HttpResponse.json({ access_token: 'nuevo', token_type: 'bearer' })))
    const incidencias = vi.fn(rechazar)
    servidor.use(http.get(`${BASE}/incidencias`, incidencias))
    await expect(api('/incidencias')).rejects.toBeInstanceOf(NoAutenticadoError)
    expect(incidencias).toHaveBeenCalledTimes(2)
    expect(useAuth.getState().usuario).toBeNull()
  })

  it('logout limpia cache', async () => {
    const qc = crearQueryClient()
    qc.setQueryData(['incidencias'], [{ _id: 'a' }])
    useAuth.setState({ token: 'vigente', usuario })
    let credenciales: RequestCredentials | undefined
    servidor.use(http.post(`${BASE}/auth/logout`, ({ request }) => {
      credenciales = request.credentials
      return new HttpResponse(null, { status: 204 })
    }))
    const { result } = renderHook(() => useLogout(), { wrapper: envoltorio(qc) })
    await act(() => result.current.mutateAsync())
    expect(credenciales).toBe('include')
    expect(useAuth.getState().token).toBeNull()
    expect(useAuth.getState().usuario).toBeNull()
    expect(qc.getQueryData(['incidencias'])).toBeUndefined()
  })

  it('logout limpia la sesión local aunque la api no responda', async () => {
    const qc = crearQueryClient()
    qc.setQueryData(['incidencias'], [])
    useAuth.setState({ token: 'vigente', usuario })
    servidor.use(http.post(`${BASE}/auth/logout`, () => HttpResponse.error()))
    const { result } = renderHook(() => useLogout(), { wrapper: envoltorio(qc) })
    await act(() => result.current.mutateAsync())
    expect(useAuth.getState().token).toBeNull()
    expect(qc.getQueryData(['incidencias'])).toBeUndefined()
  })

  it('login guarda el token solo en memoria y pide la cookie de refresh', async () => {
    const qc = crearQueryClient()
    let credenciales: RequestCredentials | undefined
    servidor.use(http.post(`${BASE}/auth/login`, ({ request }) => {
      credenciales = request.credentials
      return HttpResponse.json({ access_token: 'acceso', token_type: 'bearer', usuario })
    }))
    const { result } = renderHook(() => useLogin(), { wrapper: envoltorio(qc) })
    await act(() => result.current.mutateAsync({ correo: 'ana@utm.edu.mx', password: 'secreta' }))
    expect(credenciales).toBe('include')
    expect(useAuth.getState().token).toBe('acceso')
    expect(JSON.stringify({ ...localStorage })).not.toContain('acceso')
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('acceso')
  })

  it('credenciales inválidas y 429 muestran mensaje en español', async () => {
    servidor.use(http.post(`${BASE}/auth/login`, () => HttpResponse.json({ detail: 'Credenciales inválidas' }, { status: 401 })))
    const { result } = renderHook(() => useLogin(), { wrapper: envoltorio(crearQueryClient()) })
    await act(async () => { await result.current.mutateAsync({ correo: 'ana@utm.edu.mx', password: 'x' }).catch(() => {}) })
    await waitFor(() => expect(result.current.error?.message).toBe('Correo o contraseña incorrectos'))
    servidor.use(http.post(`${BASE}/auth/login`, () => HttpResponse.json(
      { detail: 'Demasiados intentos fallidos; espera 15 minutos' }, { status: 429, headers: { 'Retry-After': '900' } },
    )))
    await act(async () => { await result.current.mutateAsync({ correo: 'ana@utm.edu.mx', password: 'x' }).catch(() => {}) })
    await waitFor(() => expect(result.current.error?.message).toBe('Demasiados intentos fallidos; espera 15 minutos (intenta de nuevo en 900 s)'))
  })

  it('recargar la página restaura la sesión con refresh silencioso', async () => {
    servidor.use(
      http.post(`${BASE}/auth/refresh`, () => HttpResponse.json({ access_token: 'nuevo', token_type: 'bearer' })),
      http.get(`${BASE}/auth/me`, ({ request }) =>
        request.headers.get('Authorization') === 'Bearer nuevo' ? HttpResponse.json({ _id: 'u1', correo: 'ana@utm.edu.mx', ...usuario }) : rechazar()),
    )
    const p = restaurarSesion()
    expect(useAuth.getState().restaurando).toBe(true)
    await expect(p).resolves.toBe(true)
    expect(useAuth.getState()).toMatchObject({ token: 'nuevo', usuario, restaurando: false, aviso: null })
  })

  it('sin cookie de refresh la app queda sin sesión y sin aviso', async () => {
    servidor.use(http.post(`${BASE}/auth/refresh`, () => HttpResponse.json({ detail: 'Sesión inválida o expirada' }, { status: 401 })))
    await expect(restaurarSesion()).resolves.toBe(false)
    expect(useAuth.getState()).toMatchObject({ token: null, usuario: null, restaurando: false, aviso: null })
  })
})
