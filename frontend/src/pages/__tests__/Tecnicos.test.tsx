// @vitest-environment jsdom
import '../../test/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { BASE } from '../../api/client'
import { useAuth } from '../../auth/store'
import { servidor } from '../../test/msw/server'
import Tecnicos from '../Tecnicos'

const ANA = 'a'.repeat(24)
const LUIS = 'b'.repeat(24)
const EVA = 'c'.repeat(24)
const TECNICOS = [
  { _id: ANA, nombre: 'Ana Pérez' },
  { _id: EVA, nombre: 'Eva Ruiz' },
  { _id: LUIS, nombre: 'Luis Gómez' },
]
const CARGA = [
  { tecnico_id: LUIS, incidencias_activas: 5, horas_acumuladas: 12.5 },
  { tecnico_id: ANA, incidencias_activas: 2, horas_acumuladas: 3 },
]

function UrlTablero() {
  return <output data-testid="url">{useLocation().search}</output>
}

function preparar({ tecnicos = TECNICOS, carga = CARGA, falla }: {
  tecnicos?: typeof TECNICOS; carga?: typeof CARGA; falla?: 'tecnicos' | 'carga'
} = {}) {
  let llamadasCarga = 0
  servidor.use(
    http.get(`${BASE}/usuarios/tecnicos`, () => (falla === 'tecnicos'
      ? HttpResponse.json({ error: 'no_disponible' }, { status: 503 })
      : HttpResponse.json(tecnicos))),
    http.get(`${BASE}/analitica/carga-tecnicos`, () => {
      llamadasCarga += 1
      if (falla === 'carga' && llamadasCarga === 1) return HttpResponse.json({ error: 'no_disponible' }, { status: 503 })
      return HttpResponse.json(carga)
    }),
  )
  useAuth.setState({
    token: 't',
    usuario: { nombre: 'Carla', rol: 'coordinador', alcance: 'area', permisos: ['incidencias:asignar', 'analitica:ver'] },
  })
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={['/tecnicos']}>
        <Routes>
          <Route path="/tecnicos" element={<Tecnicos />} />
          <Route path="/tablero" element={<UrlTablero />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { llamadas: () => llamadasCarga }
}

describe('Técnicos (Vitest + MSW)', () => {
  it('muestra skeleton y luego técnicos ordenados por carga, incluidos los que no tienen', async () => {
    preparar()
    expect(screen.getByLabelText('Cargando técnicos')).toBeInTheDocument()
    const lista = await screen.findByRole('list', { name: 'Carga por técnico' })
    const enlaces = within(lista).getAllByRole('link')
    expect(enlaces.map((e) => e.getAttribute('aria-label'))).toEqual([
      'Luis Gómez: 5 incidencias activas, 12.5 horas. Ver en el tablero',
      'Ana Pérez: 2 incidencias activas, 3 horas. Ver en el tablero',
      'Eva Ruiz: 0 incidencias activas, 0 horas. Ver en el tablero',
    ])
    expect(within(lista).getByText('5 activas · 12.5 h')).toBeInTheDocument()
  })

  it('enlaza al tablero filtrado por el técnico', async () => {
    preparar()
    const persona = userEvent.setup()
    await persona.click(await screen.findByRole('link', { name: /^Luis Gómez/ }))
    expect(screen.getByTestId('url')).toHaveTextContent(`?tecnico=${LUIS}`)
  })

  it('muestra estado vacío sin técnicos', async () => {
    preparar({ tecnicos: [], carga: [] })
    expect(await screen.findByText('Aún no hay técnicos en tu alcance')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ir al tablero' })).toHaveAttribute('href', '/tablero')
  })

  it('muestra error y reintenta la consulta de carga', async () => {
    const { llamadas } = preparar({ falla: 'carga' })
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar a los técnicos')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('link', { name: /^Luis Gómez/ })).toBeInTheDocument()
    expect(llamadas()).toBe(2)
  })

  it('muestra error si falla la lista de técnicos', async () => {
    preparar({ falla: 'tecnicos' })
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar a los técnicos')
  })
})
