import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { BASE } from '../../api/client'
import { servidor } from '../../test/msw/server'
import Reportar from '../Reportar'

vi.mock('browser-image-compression', () => ({ default: vi.fn(async (archivo: File) => archivo) }))

const SUGERENCIA = {
  es_incidencia_valida: true,
  categoria: 'computo_redes',
  titulo: 'Proyector no enciende en el aula 3',
  descripcion: 'El proyector del aula 3 no enciende desde ayer por la mañana',
  prioridad_sugerida: 'alta',
  tags: ['proyector', 'aula_3'],
  campos_detectados: [],
  confianza: 0.9,
  advertencias: [],
}

function renderReportar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Reportar />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Reportar → evidencia (T-041)', () => {
  it('crea el ticket aunque falle la subida de la foto', async () => {
    let creadas = 0
    servidor.use(
      http.post(`${BASE}/ia/analizar-imagen`, () => HttpResponse.json(SUGERENCIA)),
      http.post(`${BASE}/incidencias`, () => {
        creadas += 1
        return HttpResponse.json({ _id: 'inc1', codigo: 'INC-2026-0001', estado: 'abierta' }, { status: 201 })
      }),
      http.post(`${BASE}/incidencias/inc1/evidencias/firma`, () =>
        HttpResponse.json({ evidencia_id: 'e1', url_storage: 'evidencias/x.jpg', upload_url: 'https://bucket/falla', expira_en: 300 }),
      ),
      http.put('https://bucket/falla', () => HttpResponse.json({ error: 'servidor' }, { status: 500 })),
    )
    renderReportar()
    const user = userEvent.setup()
    await user.upload(
      screen.getByLabelText('Foto de la incidencia'),
      new File(['foto'], 'foto.jpg', { type: 'image/jpeg' }),
    )

    await waitFor(() => expect(screen.getByLabelText(/Título/)).toHaveValue('Proyector no enciende en el aula 3'))
    await user.type(screen.getByLabelText('Edificio'), 'Edificio A')
    await user.type(screen.getByLabelText('Aula'), 'A-301')
    await user.type(screen.getByLabelText('IP'), '10.0.0.5')
    await user.click(screen.getByRole('button', { name: 'Enviar reporte' }))

    expect(await screen.findByText(/No se pudo adjuntar la foto, reintentar/)).toBeInTheDocument()
    expect(creadas).toBe(1)
    expect(screen.getByRole('button', { name: 'Reintentar foto' })).toBeInTheDocument()
  })
})
