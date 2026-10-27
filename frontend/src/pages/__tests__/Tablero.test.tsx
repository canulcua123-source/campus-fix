// @vitest-environment jsdom
import '../../test/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { BASE } from '../../api/client'
import { useAuth } from '../../auth/store'
import type { IncidenciaListaItem } from '../../schemas/incidencia'
import { servidor } from '../../test/msw/server'
import Tablero from '../Tablero'

const ANA = 'a'.repeat(24)
const LUIS = 'b'.repeat(24)

const INC: IncidenciaListaItem = {
  _id: 'inc1', codigo: 'INC-2026-1020-INF-0001', titulo: 'Fuga en el baño', categoria: 'infraestructura', estado: 'abierta',
  prioridad: 'alta', ubicacion: { edificio: 'Edificio A', aula: 'A-101' }, tags: [], fecha_creacion: '2026-10-20T08:00:00Z',
}

function Ubicacion() {
  return <output data-testid="url">{useLocation().search}</output>
}

function renderTablero(ruta = '/tablero') {
  useAuth.setState({
    token: 't',
    usuario: { nombre: 'Carla', rol: 'coordinador', permisos: ['incidencias:ver', 'incidencias:asignar'], alcance: 'area' },
  })
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[ruta]}><Tablero /><Ubicacion /></MemoryRouter>
    </QueryClientProvider>,
  )
}

function simular(lista: IncidenciaListaItem[] = [INC]) {
  const consultas: URLSearchParams[] = []
  const tecnicos: URLSearchParams[] = []
  servidor.use(
    http.get(`${BASE}/incidencias`, ({ request }) => {
      consultas.push(new URL(request.url).searchParams)
      return HttpResponse.json(lista)
    }),
    http.get(`${BASE}/usuarios/tecnicos`, ({ request }) => {
      const q = new URL(request.url).searchParams
      tecnicos.push(q)
      // El backend devuelve solo los del área pedida.
      return HttpResponse.json(q.get('area') === 'infraestructura' ? [{ _id: ANA, nombre: 'Ana Infra' }] : [
        { _id: ANA, nombre: 'Ana Infra' }, { _id: LUIS, nombre: 'Luis Infra' },
      ])
    }),
  )
  return { consultas, tecnicos }
}

describe('Tablero (T-054)', () => {
  it('aplica filtros en query', async () => {
    const { consultas } = simular()
    servidor.use(http.get(`${BASE}/aulas/ubicaciones`, () => HttpResponse.json([{ edificio: 'C', piso: 1, aula: '101' }])))
    renderTablero(`/tablero?estado=abierta&prioridad=alta&edificio=Edificio%20A&tecnico=${LUIS}&otro=x`)

    await screen.findByText('Fuga en el baño')
    expect(Object.fromEntries(consultas[0])).toEqual({ estado: 'abierta', prioridad: 'alta', edificio: 'Edificio A', tecnico: LUIS })

    const usuario = userEvent.setup()
    await usuario.selectOptions(screen.getByLabelText('Prioridad'), 'critica')
    await waitFor(() => expect(consultas.at(-1)?.get('prioridad')).toBe('critica'))
    expect(screen.getByTestId('url')).toHaveTextContent('prioridad=critica')
    expect(screen.getByTestId('url')).toHaveTextContent('estado=abierta')

    await usuario.selectOptions(screen.getByLabelText('Técnico'), 'sin_asignar')
    await waitFor(() => expect(consultas.at(-1)?.get('tecnico')).toBe('sin_asignar'))

    // Lista: catálogo de aulas + edificios de las incidencias + el valor de la URL.
    const edificio = await screen.findByRole('combobox', { name: 'Edificio' })
    await waitFor(() => expect(within(edificio).getByRole('option', { name: 'Edificio C' })).toBeInTheDocument())
    expect(within(edificio).getByRole('option', { name: 'Edificio A' })).toBeInTheDocument()
    await usuario.selectOptions(edificio, 'C')
    await waitFor(() => expect(consultas.at(-1)?.get('edificio')).toBe('C'))

    await usuario.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    await waitFor(() => expect([...consultas.at(-1)!.keys()]).toEqual([]))
    expect(screen.getByTestId('url')).toHaveTextContent('otro=x')
  })

  it('ignora filtros inválidos de la URL', async () => {
    const { consultas } = simular()
    renderTablero('/tablero?estado=borrado&tecnico=malo')
    await screen.findByText('Fuga en el baño')
    expect([...consultas[0].keys()]).toEqual([])
  })

  it('asigna tecnico', async () => {
    simular()
    let cuerpo: unknown = null
    servidor.use(http.patch(`${BASE}/incidencias/inc1/asignacion`, async ({ request }) => {
      cuerpo = await request.json()
      return HttpResponse.json({ ok: true, tecnico_asignado: { usuario_id: ANA, nombre: 'Ana Infra' } })
    }))
    renderTablero()

    const usuario = userEvent.setup()
    await usuario.click(await screen.findByRole('button', { name: `Asignar ${INC.codigo}` }))
    const hoja = screen.getByRole('dialog', { name: 'Asignar técnico' })
    await usuario.click(await within(hoja).findByRole('radio', { name: /Ana Infra/ }))
    await usuario.click(within(hoja).getByRole('button', { name: 'Asignar' }))

    expect(await screen.findByText(/quedó asignada a Ana Infra/)).toBeInTheDocument()
    expect(cuerpo).toEqual({ tecnico_id: ANA })
  })

  it('reasignar muestra el error de la API', async () => {
    simular([{ ...INC, tecnico_asignado: { usuario_id: LUIS, nombre: 'Luis Infra' } }])
    servidor.use(http.patch(`${BASE}/incidencias/inc1/asignacion`, () =>
      HttpResponse.json({ error: 'conflicto', detalle: 'La incidencia no admite asignación' }, { status: 409 })))
    renderTablero()

    const usuario = userEvent.setup()
    await usuario.click(await screen.findByRole('button', { name: `Reasignar ${INC.codigo}` }))
    const hoja = screen.getByRole('dialog', { name: 'Reasignar técnico' })
    await usuario.click(await within(hoja).findByRole('radio', { name: /Ana Infra/ }))
    await usuario.click(within(hoja).getByRole('button', { name: 'Reasignar' }))
    expect(await within(hoja).findByRole('alert')).toHaveTextContent('La incidencia no admite asignación')
  })

  it('selector solo area', async () => {
    const { tecnicos } = simular()
    renderTablero()

    await userEvent.setup().click(await screen.findByRole('button', { name: `Asignar ${INC.codigo}` }))
    const hoja = screen.getByRole('dialog', { name: 'Asignar técnico' })
    await within(hoja).findByRole('radio', { name: /Ana Infra/ })
    expect(within(hoja).getAllByRole('radio')).toHaveLength(1)
    expect(within(hoja).queryByText('Luis Infra')).not.toBeInTheDocument()
    expect(tecnicos.some((q) => q.get('area') === 'infraestructura')).toBe(true)
  })

  it('estado vacío', async () => {
    simular([])
    renderTablero()
    expect(await screen.findByText('Sin incidencias con estos filtros')).toBeInTheDocument()
  })

  it('error con reintentar', async () => {
    simular()
    servidor.use(http.get(`${BASE}/incidencias`, () => HttpResponse.json({ error: 'servidor' }, { status: 500 })))
    renderTablero()
    expect(await screen.findByText('No pudimos cargar el tablero')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })
})
