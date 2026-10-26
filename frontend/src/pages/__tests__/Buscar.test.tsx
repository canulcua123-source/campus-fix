// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { BASE } from '../../api/client'
import { useAuth } from '../../auth/store'
import { AppShell } from '../../components/AppShell'
import type { IncidenciaListaItem } from '../../schemas/incidencia'
import { servidor } from '../../test/msw/server'
import Buscar from '../Buscar'

vi.mock('../../components/UpdatePrompt', () => ({ UpdatePrompt: () => null }))

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: 'error' })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

afterEach(() => {
  cleanup()
  servidor.resetHandlers()
  useAuth.setState({ token: null, usuario: null, aviso: null })
})

afterAll(() => servidor.close())

const RESULTADOS: IncidenciaListaItem[] = [
  {
    _id: 'mas-relevante', codigo: 'INC-RED-0002', titulo: 'Red sin conexión', categoria: 'computo_redes', estado: 'abierta', prioridad: 'alta',
    ubicacion: { edificio: 'Edificio Red', aula: 'R-2' }, tags: [], fecha_creacion: '2026-10-23T08:00:00Z', score: 8.75,
  },
  {
    _id: 'menos-relevante', codigo: 'INC-RED-0001', titulo: 'Revisión de red', categoria: 'computo_redes', estado: 'abierta', prioridad: 'media',
    ubicacion: { edificio: 'Edificio Red', aula: 'R-1' }, tags: [], fecha_creacion: '2026-10-22T08:00:00Z', score: 2.5,
  },
]

function prepararUsuario(rol = 'tecnico') {
  useAuth.setState({
    usuario: { nombre: 'Ana', rol, permisos: ['incidencias:ver', 'incidencias:buscar'], alcance: rol === 'directivo' ? 'global' : 'area' },
  })
}

function renderBuscar(ruta = '/buscar?q=red') {
  prepararUsuario()
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[ruta]}>
        <Routes><Route path="/buscar" element={<Buscar />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function renderConBarra() {
  prepararUsuario()
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<p>Inicio</p>} />
            <Route path="buscar" element={<Buscar />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function responder(lista: IncidenciaListaItem[], alConsultar?: () => void) {
  servidor.use(http.get(`${BASE}/incidencias/buscar`, ({ request }) => {
    expect(new URL(request.url).searchParams.get('q')).toBeTruthy()
    alConsultar?.()
    return HttpResponse.json(lista)
  }))
}

describe('Buscar (T-055)', () => {
  it('aplica debounce de 300 ms antes de consultar', async () => {
    let consultas = 0
    responder(RESULTADOS, () => { consultas += 1 })
    renderConBarra()

    const usuario = userEvent.setup()
    await usuario.type(screen.getByLabelText('Buscar incidencias'), 're')
    await new Promise((resolver) => window.setTimeout(resolver, 250))
    expect(consultas).toBe(0)

    expect(await screen.findByText((_, elemento) => elemento?.tagName === 'H2' && elemento.textContent === 'Red sin conexión')).toBeInTheDocument()
    expect(consultas).toBe(1)
  })

  it('respeta el orden por score que entrega el backend', async () => {
    responder(RESULTADOS)
    renderBuscar()

    await screen.findByRole('link', { name: /Red sin conexión/i })
    expect(screen.getAllByRole('link').map((enlace) => enlace.textContent)).toEqual([
      expect.stringContaining('Red sin conexión'),
      expect.stringContaining('Revisión de red'),
    ])
    expect(screen.getByText('Relevancia: 8.75')).toBeInTheDocument()
  })

  it('muestra una sugerencia si no hay resultados', async () => {
    responder([])
    renderBuscar('/buscar?q=interruptor')

    expect(await screen.findByText('Sin resultados')).toBeInTheDocument()
    expect(screen.getByText(/Prueba con otras palabras/i)).toBeInTheDocument()
  })

  it('no consulta con menos de dos caracteres', async () => {
    let consultas = 0
    responder(RESULTADOS, () => { consultas += 1 })
    renderBuscar('/buscar?q=r')

    expect(await screen.findByText('Busca incidencias')).toBeInTheDocument()
    expect(consultas).toBe(0)
  })

  it('permite al directivo abrir el resultado en el detalle de solo lectura', async () => {
    responder(RESULTADOS)
    prepararUsuario('directivo')
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter initialEntries={['/buscar?q=red']}><Routes><Route path="/buscar" element={<Buscar />} /></Routes></MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByRole('link', { name: /Red sin conexión/i })).toHaveAttribute('href', '/incidencias/mas-relevante')
  })
})
