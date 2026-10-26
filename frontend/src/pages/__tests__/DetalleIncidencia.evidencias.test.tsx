// @vitest-environment jsdom
import '../../test/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { BASE } from '../../api/client'
import { useAuth } from '../../auth/store'
import type { EvidenciaAdjunta, IncidenciaDetalle } from '../../schemas/incidencia'
import type { Permiso } from '../../schemas/usuario'
import { detallePrueba } from '../../test/detalle-fixture'
import { servidor } from '../../test/msw/server'
import DetalleIncidencia from '../DetalleIncidencia'

const ID = detallePrueba._id
const RUTA = `${BASE}/incidencias/${ID}`
const BUCKET = 'https://bucket.example.test/put'

function iniciarSesion(permisos: Permiso[]) {
  useAuth.setState({
    token: 't',
    usuario: { nombre: 'Ana López', rol: 'reportante', permisos, alcance: 'propio' },
  })
}

function renderDetalle() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[`/incidencias/${ID}`]}>
        <Routes><Route path="/incidencias/:id" element={<DetalleIncidencia />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const evidencia = (n: number): EvidenciaAdjunta => ({
  evidencia_id: `e${n}`, nombre_archivo: `foto-${n}.jpg`, tipo_mime: 'image/jpeg', peso_kb: 120,
  url_storage: `evidencias/x/e${n}.jpg`, fecha_carga: '2026-10-20T10:00:00Z', subido_por: 'u1',
})

describe('DetalleIncidencia: adjuntar evidencias (T-048)', () => {
  it('no muestra el botón sin el permiso evidencias:subir', async () => {
    iniciarSesion(['incidencias:ver'])
    servidor.use(http.get(RUTA, () => HttpResponse.json(detallePrueba)))
    renderDetalle()

    expect(await screen.findByText('Sin evidencias')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Adjuntar evidencia' })).not.toBeInTheDocument()
  })

  it('la galería se actualiza al terminar la subida', async () => {
    iniciarSesion(['incidencias:ver', 'evidencias:subir'])
    let actual: IncidenciaDetalle = { ...detallePrueba, evidencias_adjuntas: [evidencia(1)] }
    servidor.use(
      http.get(RUTA, () => HttpResponse.json(actual)),
      http.post(`${RUTA}/evidencias/firma`, () => HttpResponse.json({
        evidencia_id: 'e2', url_storage: 'evidencias/x/e2.pdf', upload_url: BUCKET, expira_en: 300,
      })),
      http.put(BUCKET, () => new HttpResponse(null, { status: 200 })),
      http.post(`${RUTA}/evidencias`, () => {
        actual = { ...actual, evidencias_adjuntas: [evidencia(1), { ...evidencia(2), nombre_archivo: 'acta.pdf', tipo_mime: 'application/pdf' }] }
        return HttpResponse.json({ ok: true, evidencia_id: 'e2' }, { status: 201 })
      }),
    )
    renderDetalle()
    expect(await screen.findByRole('button', { name: 'Ver foto-1.jpg' })).toBeInTheDocument()
    expect(screen.getByText(/1 de 10/)).toBeInTheDocument()

    await userEvent.upload(screen.getByLabelText('Archivo de evidencia'), new File(['%PDF'], 'acta.pdf', { type: 'application/pdf' }))

    expect(await screen.findByRole('button', { name: 'Ver acta.pdf' })).toBeInTheDocument()
    expect(screen.getByText(/2 de 10/)).toBeInTheDocument()
  })
})
