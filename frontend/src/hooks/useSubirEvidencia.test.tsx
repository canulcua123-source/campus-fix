import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { BASE } from '../api/client'
import { servidor } from '../test/msw/server'
import { useSubirEvidencia } from './useSubirEvidencia'

const RUTA = `${BASE}/incidencias/inc1/evidencias`
const URL_PUT = 'https://bucket/put?firma'
const ARCHIVO = new File(['foto'], 'foto.jpg', { type: 'image/jpeg' })
const FIRMA = { evidencia_id: 'e1', url_storage: 'evidencias/x.jpg', upload_url: URL_PUT, expira_en: 300 }

function envolver({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

async function subir() {
  const { result } = renderHook(() => useSubirEvidencia(), { wrapper: envolver })
  let data: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined
  await act(async () => {
    data = await result.current.mutateAsync({ incidenciaId: 'inc1', archivo: ARCHIVO, esperar: async () => {} })
  })
  return data
}

describe('useSubirEvidencia', () => {
  it('ejecuta los 3 pasos en orden', async () => {
    const pasos: string[] = []
    servidor.use(
      http.post(`${RUTA}/firma`, () => { pasos.push('firma'); return HttpResponse.json(FIRMA) }),
      http.put('https://bucket/put', () => { pasos.push('put'); return new HttpResponse(null, { status: 200 }) }),
      http.post(RUTA, () => { pasos.push('registro'); return HttpResponse.json({ ok: true, evidencia_id: 'e1' }, { status: 201 }) }),
    )

    const data = await subir()

    expect(pasos).toEqual(['firma', 'put', 'registro'])
    expect(data).toEqual({ ok: true, evidencia_id: 'e1' })
  })

  it('reintenta el PUT hasta 3 veces ante un error transitorio', async () => {
    let puts = 0
    servidor.use(
      http.post(`${RUTA}/firma`, () => HttpResponse.json(FIRMA)),
      http.put('https://bucket/put', () => {
        puts += 1
        return puts < 3
          ? HttpResponse.json({ error: 'servidor' }, { status: 500 })
          : new HttpResponse(null, { status: 200 })
      }),
      http.post(RUTA, () => HttpResponse.json({ ok: true, evidencia_id: 'e1' }, { status: 201 })),
    )

    const data = await subir()

    expect(puts).toBe(3)
    expect(data).toEqual({ ok: true, evidencia_id: 'e1' })
  })

  it('reintenta solo el registro, sin volver a subir el archivo', async () => {
    let firmas = 0
    let puts = 0
    let registros = 0
    servidor.use(
      http.post(`${RUTA}/firma`, () => { firmas += 1; return HttpResponse.json(FIRMA) }),
      http.put('https://bucket/put', () => { puts += 1; return new HttpResponse(null, { status: 200 }) }),
      http.post(RUTA, () => {
        registros += 1
        return registros === 1
          ? HttpResponse.json({ error: 'servidor' }, { status: 500 })
          : HttpResponse.json({ ok: true, evidencia_id: 'e1' }, { status: 201 })
      }),
    )

    const data = await subir()

    expect(firmas).toBe(1)
    expect(puts).toBe(1)
    expect(registros).toBe(2)
    expect(data).toEqual({ ok: true, evidencia_id: 'e1' })
  })
})
