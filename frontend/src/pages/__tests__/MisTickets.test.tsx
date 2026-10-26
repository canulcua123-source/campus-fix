// @vitest-environment jsdom
import '../../test/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { BASE } from '../../api/client'
import { useAuth } from '../../auth/store'
import type { IncidenciaListaItem } from '../../schemas/incidencia'
import { servidor } from '../../test/msw/server'
import MisTickets from '../MisTickets'

const BASE_INC: IncidenciaListaItem = {
  _id: 'a1', codigo: 'INC-2026-1020-INF-0001', titulo: 'Luminaria fundida', categoria: 'infraestructura', estado: 'abierta',
  prioridad: 'media', ubicacion: { edificio: 'Edificio A', aula: 'A-101' }, tags: [], fecha_creacion: '2026-10-20T08:00:00Z',
}

function Ubicacion() {
  const { search } = useLocation()
  return <output data-testid="url">{search}</output>
}

function renderMis(ruta = '/mis-tickets') {
  useAuth.setState({
    token: 't', usuario: { nombre: 'Ana', rol: 'reportante', permisos: ['incidencias:ver', 'incidencias:crear'], alcance: 'propio' },
  })
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[ruta]}><MisTickets /><Ubicacion /></MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Responde según ?estado= y guarda las consultas recibidas. */
function responder(lista: IncidenciaListaItem[]) {
  const consultas: URLSearchParams[] = []
  servidor.use(http.get(`${BASE}/incidencias`, ({ request }) => {
    const q = new URL(request.url).searchParams
    consultas.push(q)
    const estado = q.get('estado')
    return HttpResponse.json(estado ? lista.filter((i) => i.estado === estado) : lista)
  }))
  return consultas
}

describe('MisTickets (T-045)', () => {
  it('muestra lista', async () => {
    const consultas = responder([BASE_INC, { ...BASE_INC, _id: 'a2', codigo: 'INC-2', titulo: 'Proyector sin señal', estado: 'resuelta' }])
    renderMis()

    const enlace = await screen.findByRole('link', { name: /Luminaria fundida/ })
    expect(enlace).toHaveAttribute('href', '/incidencias/a1')
    expect(screen.getByText('Proyector sin señal')).toBeInTheDocument()
    expect(consultas[0].get('propias')).toBe('true')
  })

  it('filtra por estado', async () => {
    const consultas = responder([BASE_INC, { ...BASE_INC, _id: 'a2', codigo: 'INC-2', titulo: 'Proyector sin señal', estado: 'resuelta' }])
    renderMis()
    await screen.findByText('Luminaria fundida')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Resuelta' }))

    expect(await screen.findByText('Proyector sin señal')).toBeInTheDocument()
    expect(screen.queryByText('Luminaria fundida')).not.toBeInTheDocument()
    expect(screen.getByTestId('url')).toHaveTextContent('?estado=resuelta')
    expect(screen.getByRole('button', { name: 'Resuelta' })).toHaveAttribute('aria-pressed', 'true')
    expect(consultas.at(-1)?.get('estado')).toBe('resuelta')
  })

  it('lee el filtro desde la URL', async () => {
    const consultas = responder([BASE_INC])
    renderMis('/mis-tickets?estado=en_espera')

    expect(await screen.findByText('No tienes reportes en estado En espera')).toBeInTheDocument()
    expect(consultas[0].get('estado')).toBe('en_espera')
  })

  it('estado vacío', async () => {
    responder([])
    renderMis()

    expect(await screen.findByText('Aún no tienes reportes')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Reportar' })).toHaveAttribute('href', '/reportar')
  })

  it('error con reintentar', async () => {
    let fallar = true
    servidor.use(http.get(`${BASE}/incidencias`, () =>
      fallar ? HttpResponse.json({ error: 'servidor' }, { status: 500 }) : HttpResponse.json([BASE_INC])))
    renderMis()

    expect(await screen.findByText('No pudimos cargar tus reportes')).toBeInTheDocument()
    fallar = false
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Luminaria fundida')).toBeInTheDocument()
  })
})
