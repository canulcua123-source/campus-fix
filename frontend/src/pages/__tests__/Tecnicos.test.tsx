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
    const filas = within(lista).getAllByRole('button')
    expect(filas.map((e) => e.getAttribute('aria-label'))).toEqual([
      'Luis Gómez: 5 incidencias activas, 12.5 horas. Ver su operación',
      'Ana Pérez: 2 incidencias activas, 3 horas. Ver su operación',
      'Eva Ruiz: 0 incidencias activas, 0 horas. Ver su operación',
    ])
    expect(within(lista).getByText('5 activas · 12.5 h')).toBeInTheDocument()
  })

  it('abre la operación del técnico agrupada por etapa y enlaza al tablero filtrado', async () => {
    preparar()
    let pedido = ''
    servidor.use(http.get(`${BASE}/incidencias`, ({ request }) => {
      pedido = new URL(request.url).search
      return HttpResponse.json([
        { _id: 'a1', codigo: 'INC-A1', titulo: 'Proyector apagado', categoria: 'computo_redes', estado: 'en_proceso', prioridad: 'alta', ubicacion: { edificio: 'A', piso: 1, aula: '101' }, fecha_creacion: '2026-10-20T10:00:00Z', tecnico_asignado: { usuario_id: LUIS, nombre: 'Luis Gómez' } },
        { _id: 'a2', codigo: 'INC-A2', titulo: 'Falta cable', categoria: 'computo_redes', estado: 'en_espera', prioridad: 'media', ubicacion: { edificio: 'A', piso: 1, aula: '102' }, fecha_creacion: '2026-10-19T10:00:00Z', tecnico_asignado: { usuario_id: LUIS, nombre: 'Luis Gómez' } },
        { _id: 'a3', codigo: 'INC-A3', titulo: 'Ya quedó', categoria: 'computo_redes', estado: 'resuelta', prioridad: 'baja', ubicacion: { edificio: 'B', piso: 2, aula: '201' }, fecha_creacion: '2026-10-18T10:00:00Z', tecnico_asignado: { usuario_id: LUIS, nombre: 'Luis Gómez' } },
      ])
    }))
    const persona = userEvent.setup()
    await persona.click(await screen.findByRole('button', { name: /^Luis Gómez/ }))
    const panel = await screen.findByRole('dialog', { name: 'Operación de Luis Gómez' })
    expect(await within(panel).findByRole('list', { name: 'En curso' })).toHaveTextContent('Proyector apagado')
    expect(within(panel).getByRole('list', { name: 'En espera' })).toHaveTextContent('Falta cable')
    expect(within(panel).getByRole('list', { name: 'Por confirmar' })).toHaveTextContent('Ya quedó')
    expect(pedido).toContain(`tecnico=${LUIS}`)
    await persona.click(within(panel).getByRole('link', { name: 'Ver en el tablero' }))
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
    expect(await screen.findByRole('button', { name: /^Luis Gómez/ })).toBeInTheDocument()
    expect(llamadas()).toBe(2)
  })

  it('muestra error si falla la lista de técnicos', async () => {
    preparar({ falla: 'tecnicos' })
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar a los técnicos')
  })
})
