// @vitest-environment jsdom
import '../../test/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { BASE } from '../../api/client'
import { useAuth } from '../../auth/store'
import type { IncidenciaListaItem } from '../../schemas/incidencia'
import { servidor } from '../../test/msw/server'
import Inicio from '../Inicio'

const inc = (id: string, estado: string, fecha: string): IncidenciaListaItem => ({
  _id: id, codigo: `INC-${id}`, titulo: `Falla ${id}`, categoria: 'infraestructura', estado: estado as IncidenciaListaItem['estado'],
  prioridad: 'media', ubicacion: { edificio: 'Edificio A', aula: 'A-101' }, tags: [], fecha_creacion: fecha,
})

let consultas: URLSearchParams[] = []

function montar(lista: IncidenciaListaItem[] | 'error') {
  consultas = []
  servidor.use(http.get(`${BASE}/incidencias`, ({ request }) => {
    consultas.push(new URL(request.url).searchParams)
    return lista === 'error' ? HttpResponse.json({ error: 'x' }, { status: 500 }) : HttpResponse.json(lista)
  }))
  useAuth.setState({
    token: 't', usuario: { nombre: 'Ana López', rol: 'reportante', permisos: ['incidencias:ver', 'incidencias:crear'], alcance: 'propio' },
  })
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={cliente}><MemoryRouter><Inicio /></MemoryRouter></QueryClientProvider>)
}

describe('Inicio', () => {
  it('saluda y ofrece reportar', async () => {
    montar([])
    expect(screen.getByRole('heading', { level: 1, name: 'Hola, Ana' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Reportar un problema/ })).toHaveAttribute('href', '/reportar')
    expect(await screen.findByText('Así de fácil es reportar')).toBeInTheDocument()
  })

  it('resume los reportes propios y muestra los 3 más recientes', async () => {
    montar([
      inc('1', 'abierta', '2026-10-20T08:00:00Z'),
      inc('2', 'abierta', '2026-10-21T08:00:00Z'),
      inc('3', 'en_proceso', '2026-10-22T08:00:00Z'),
      inc('4', 'resuelta', '2026-10-23T08:00:00Z'),
    ])
    const resumen = await screen.findByRole('group', { name: 'Resumen de tus reportes' })
    expect(await within(resumen).findByText('2')).toBeInTheDocument()
    const enlaces = screen.getAllByRole('link', { name: /Falla/ })
    expect(enlaces.map((e) => e.getAttribute('href'))).toEqual(['/incidencias/4', '/incidencias/3', '/incidencias/2'])
  })

  it('solo pide los reportes propios (propias=true), aunque el rol vea todo el campus', async () => {
    montar([])
    await screen.findByText('Así de fácil es reportar')
    expect(consultas.length).toBeGreaterThan(0)
    expect(consultas.every((q) => q.get('propias') === 'true')).toBe(true)
  })

  it('muestra error con reintento', async () => {
    montar('error')
    expect(await screen.findByRole('button', { name: /reintentar/i })).toBeInTheDocument()
  })
})
