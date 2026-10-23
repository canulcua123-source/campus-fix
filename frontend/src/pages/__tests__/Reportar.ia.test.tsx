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
  campos_detectados: [
    { nombre: 'equipo', valor: 'proyector' },
    { nombre: 'ubicacion', valor: 'aula 3' },
  ],
  confianza: 0.82,
  advertencias: [],
}

const URL_IA = `${BASE}/ia/analizar-imagen`

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

async function subirFoto() {
  const user = userEvent.setup()
  await user.upload(
    screen.getByLabelText('Foto de la incidencia'),
    new File(['foto'], 'foto.jpg', { type: 'image/jpeg' }),
  )
  return user
}

function diferir() {
  let liberar!: () => void
  const espera = new Promise<void>((r) => { liberar = r })
  return { espera, liberar }
}

describe('Reportar con IA (T-024)', () => {
  it('muestra el formulario antes de que termine la IA', async () => {
    const { espera, liberar } = diferir()
    servidor.use(http.post(URL_IA, async () => { await espera; return HttpResponse.json(SUGERENCIA) }))
    renderReportar()
    await subirFoto()

    expect(await screen.findByLabelText(/Título/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continuar sin IA' })).toBeInTheDocument()

    liberar()
    expect(await screen.findByText(/Sugerencia de IA/)).toBeInTheDocument()
  })

  it('no sobrescribe un campo que el usuario ya editó', async () => {
    const { espera, liberar } = diferir()
    servidor.use(http.post(URL_IA, async () => { await espera; return HttpResponse.json(SUGERENCIA) }))
    renderReportar()
    const user = await subirFoto()

    const titulo = await screen.findByLabelText(/Título/)
    await user.type(titulo, 'Proyector roto en el aula 3')
    liberar()

    expect(await screen.findByText(/Sugerencia de IA/)).toBeInTheDocument()
    expect(titulo).toHaveValue('Proyector roto en el aula 3')
  })

  it('pide confirmación antes de aceptar prioridad crítica', async () => {
    servidor.use(http.post(URL_IA, () => HttpResponse.json({ ...SUGERENCIA, prioridad_sugerida: 'critica' })))
    renderReportar()
    await subirFoto()

    expect(await screen.findByText(/La IA sugiere prioridad crítica/)).toBeInTheDocument()
    const prioridad = screen.getByLabelText(/Prioridad/)
    expect(prioridad).toHaveValue('media')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Sí, es crítica' }))
    await waitFor(() => expect(prioridad).toHaveValue('critica'))
    expect(screen.queryByText(/La IA sugiere prioridad crítica/)).not.toBeInTheDocument()
  })

  it('continúa en manual si la IA no está disponible (503)', async () => {
    servidor.use(http.post(URL_IA, () =>
      HttpResponse.json({ error: 'no_disponible', detalle: 'El servicio de IA no está disponible' }, { status: 503 }),
    ))
    renderReportar()
    await subirFoto()

    expect(await screen.findByText(/No se pudo analizar la foto con IA/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Título/)).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Continuar sin IA' })).toBeInTheDocument()
  })

  it('envía el contexto opcional en el análisis', async () => {
    const agregarCampo = vi.spyOn(FormData.prototype, 'append')
    servidor.use(http.post(URL_IA, () => HttpResponse.json(SUGERENCIA)))
    renderReportar()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Contexto para la IA (opcional)'), 'El proyector se apaga solo')
    await user.upload(
      screen.getByLabelText('Foto de la incidencia'),
      new File(['foto'], 'foto.jpg', { type: 'image/jpeg' }),
    )

    await screen.findByText(/Sugerencia de IA/)
    expect(agregarCampo).toHaveBeenCalledWith('contexto', 'El proyector se apaga solo')
  })

  it('retira la marca de IA cuando el usuario edita el campo', async () => {
    servidor.use(http.post(URL_IA, () => HttpResponse.json(SUGERENCIA)))
    renderReportar()
    const user = await subirFoto()

    const titulo = await screen.findByLabelText(/Título/)
    expect(screen.getAllByText(/Sugerido por IA · 82 %/).length).toBeGreaterThan(0)
    await user.type(titulo, ' corregido')
    expect(titulo.previousElementSibling).not.toHaveTextContent('Sugerido por IA')
  })
})
