// @vitest-environment jsdom
import '../../test/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { BASE } from '../../api/client'
import { servidor } from '../../test/msw/server'
import Reportar from '../Reportar'

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:prueba')
  URL.revokeObjectURL = vi.fn()
})

vi.mock('../../lib/fotoEnSegundoPlano', () => ({
  procesarFotoEnSegundoPlano: vi.fn(async (archivo: File) => ({ evidencia: archivo, ia: archivo, miniatura: archivo, calidad: { nitidez: 500, brillo: 120, borrosa: false, oscura: false, sobreexpuesta: false }, ancho: 1, alto: 1 })),
}))

const SUGERENCIA = {
  accion: 'formulario', motivos: ['Confirma la ubicación.'], analisis_id: '901bba9a-9e5f-4cb9-8fe4-4c22710ad5a4', accion_asistida: 'autollenar',
  mensaje: 'Completamos el formulario con la sugerencia de la IA.',
  cache: false,
  analisis: {
    es_incidencia_valida: true,
    categoria: 'computo_redes',
    titulo: 'Proyector no enciende en el aula 3',
    descripcion: 'El proyector del aula 3 no enciende desde ayer por la mañana',
    prioridad_sugerida: 'alta',
    tags: ['proyector', 'aula_3'],
    campos_detectados: [],
    confianza: 0.9,
    advertencias: [],
  },
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

function esperarFormulario() {
  return waitFor(() => expect(screen.getByLabelText(/Título/)).toHaveValue('Proyector no enciende en el aula 3'))
}

async function llenarYEnviar(user: ReturnType<typeof userEvent.setup>) {
  await esperarFormulario()
  await user.type(screen.getByLabelText('Edificio'), 'Edificio A')
  await user.type(screen.getByLabelText('Aula'), 'A-301')
  await user.type(screen.getByLabelText('IP'), '10.0.0.5')
  await user.click(screen.getByRole('button', { name: 'Enviar reporte' }))
}

describe('Reportar → evidencia (T-041)', () => {
  it('crea el ticket aunque falle la subida y reintenta sin repetir firma ni ticket', async () => {
    let creadas = 0
    let firmas = 0
    let puts = 0
    let registros = 0
    let bucketDisponible = false
    servidor.use(
      http.post(`${BASE}/ia/analizar-imagen`, () => HttpResponse.json(SUGERENCIA)),
      http.post(`${BASE}/incidencias`, () => {
        creadas += 1
        return HttpResponse.json({ _id: 'inc1', codigo: 'INC-2026-0001', estado: 'abierta' }, { status: 201 })
      }),
      http.post(`${BASE}/incidencias/inc1/evidencias/firma`, () => {
        firmas += 1
        return HttpResponse.json({ evidencia_id: 'e1', url_storage: 'evidencias/x.jpg', upload_url: 'https://bucket/put', expira_en: 300 })
      }),
      http.put('https://bucket/put', () => {
        puts += 1
        return bucketDisponible ? new HttpResponse(null, { status: 200 }) : HttpResponse.json({ error: 'servidor' }, { status: 500 })
      }),
      http.post(`${BASE}/incidencias/inc1/evidencias`, () => {
        registros += 1
        return HttpResponse.json({ ok: true, evidencia_id: 'e1' }, { status: 201 })
      }),
    )
    renderReportar()
    const user = userEvent.setup()
    await user.upload(
      screen.getByLabelText('Foto de la incidencia'),
      new File(['foto'], 'foto.jpg', { type: 'image/jpeg' }),
    )
    await llenarYEnviar(user)

    expect(await screen.findByText(/No se pudo adjuntar la foto, reintentar/, {}, { timeout: 5000 })).toBeInTheDocument()
    expect(creadas).toBe(1)
    expect(firmas).toBe(1)
    expect(puts).toBe(3)
    expect(registros).toBe(0)

    // El bucket vuelve: el reintento reutiliza la firma (mismo evidencia_id) y solo repite el PUT y el registro.
    bucketDisponible = true
    await user.click(screen.getByRole('button', { name: 'Reintentar foto' }))

    await waitFor(() => expect(registros).toBe(1))
    expect(creadas).toBe(1)
    expect(firmas).toBe(1)
    expect(puts).toBe(4)
  })
})
