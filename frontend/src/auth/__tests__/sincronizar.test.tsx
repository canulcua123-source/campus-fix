// @vitest-environment jsdom
import '../../test/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { BASE } from '../../api/client'
import { servidor } from '../../test/msw/server'
import { useSincronizarSesion } from '../sincronizar'
import { useAuth } from '../store'

const envoltorio = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

const me = (rol: string, permisos: string[]) => ({
  _id: '64b000000000000000000001', nombre: 'Cuenta', correo: 'admin@utm.local', rol, permisos, alcance: 'global',
  activo: true,
})

describe('useSincronizarSesion', () => {
  it('quita el menú de superadmin cuando la cuenta pasa a admin sin cerrar sesión', async () => {
    useAuth.setState({ token: 't', usuario: { nombre: 'Cuenta', rol: 'superadmin', permisos: ['sistema:administrar', 'usuarios:gestionar'], alcance: 'global' } })
    servidor.use(http.get(`${BASE}/auth/me`, () => HttpResponse.json(me('admin', ['usuarios:gestionar']))))
    renderHook(() => useSincronizarSesion(), { wrapper: envoltorio() })
    await waitFor(() => expect(useAuth.getState().usuario?.rol).toBe('admin'))
    expect(useAuth.getState().tiene('sistema:administrar')).toBe(false)
  })

  it('no consulta sin sesión', async () => {
    let llamadas = 0
    servidor.use(http.get(`${BASE}/auth/me`, () => { llamadas++; return HttpResponse.json(me('admin', [])) }))
    renderHook(() => useSincronizarSesion(), { wrapper: envoltorio() })
    await new Promise((r) => setTimeout(r, 50))
    expect(llamadas).toBe(0)
    expect(useAuth.getState().usuario).toBeNull()
  })
})
