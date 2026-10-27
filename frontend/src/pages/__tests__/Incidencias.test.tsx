// @vitest-environment jsdom
import '../../test/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { BASE } from '../../api/client'
import { useAuth } from '../../auth/store'
import type { IncidenciaListaItem } from '../../schemas/incidencia'
import { servidor } from '../../test/msw/server'
import Incidencias from '../Incidencias'

const LISTA: IncidenciaListaItem[] = [
  { _id: 'w1', codigo: 'INC-2026-1015-RED-9021', titulo: 'WiFi intermitente en aula', categoria: 'computo_redes', estado: 'en_espera', prioridad: 'media',
    ubicacion: { edificio: 'B', aula: '103' }, tags: [], fecha_creacion: '2026-10-15T08:00:00Z', tecnico_asignado: { usuario_id: 'u1', nombre: 'Luis Técnico' } },
  { _id: 'a1', codigo: 'INC-2026-1020-INF-9022', titulo: 'Aire acondicionado no enfría', categoria: 'infraestructura', estado: 'abierta', prioridad: 'alta',
    ubicacion: { edificio: 'C', aula: '204' }, tags: [], fecha_creacion: '2026-10-20T08:00:00Z' },
]

function preparar() {
  const pedidos: URLSearchParams[] = []
  servidor.use(http.get(`${BASE}/incidencias`, ({ request }) => {
    const p = new URL(request.url).searchParams
    pedidos.push(p)
    return HttpResponse.json(p.get('estado') === 'abierta' ? LISTA.filter((t) => t.estado === 'abierta') : LISTA)
  }))
  useAuth.setState({ usuario: { nombre: 'Marta', rol: 'coordinador', permisos: ['incidencias:ver', 'incidencias:buscar'], alcance: 'area' } })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/incidencias']}><Incidencias /></MemoryRouter>
    </QueryClientProvider>,
  )
  return pedidos
}

describe('Incidencias (lista)', () => {
  it('muestra todas las incidencias, de la más reciente a la más antigua', async () => {
    preparar()
    const tabla = await screen.findByRole('table', { name: 'Incidencias' })
    const titulos = within(tabla).getAllByRole('link').map((a) => a.textContent)
    expect(titulos).toEqual(['Aire acondicionado no enfría', 'WiFi intermitente en aula'])
    expect(screen.getByText('2 de 2 incidencias')).toBeInTheDocument()
  })

  it('filtra al escribir por título, folio o técnico, sin acentos', async () => {
    preparar()
    const usuario = userEvent.setup()
    await screen.findByRole('table', { name: 'Incidencias' })
    const buscar = screen.getByRole('searchbox', { name: 'Buscar' })

    await usuario.type(buscar, 'wifi')
    expect(screen.getByText('WiFi intermitente en aula')).toBeInTheDocument()
    expect(screen.queryByText('Aire acondicionado no enfría')).not.toBeInTheDocument()

    await usuario.clear(buscar)
    await usuario.type(buscar, '9022')
    expect(screen.getByText('Aire acondicionado no enfría')).toBeInTheDocument()

    await usuario.clear(buscar)
    await usuario.type(buscar, 'tecnico')
    expect(screen.getByText('WiFi intermitente en aula')).toBeInTheDocument()

    await usuario.clear(buscar)
    await usuario.type(buscar, 'proyector')
    expect(screen.getByText('Sin coincidencias')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Buscar también en descripciones' })).toHaveAttribute('href', '/buscar?q=proyector')
  })

  it('el filtro de estado se manda al servidor', async () => {
    const pedidos = preparar()
    const usuario = userEvent.setup()
    await screen.findByRole('table', { name: 'Incidencias' })
    await usuario.selectOptions(screen.getByRole('combobox', { name: 'Estado' }), 'abierta')
    await waitFor(() => expect(pedidos.at(-1)?.get('estado')).toBe('abierta'))
    await waitFor(() => expect(screen.queryByText('WiFi intermitente en aula')).not.toBeInTheDocument())
  })
})
