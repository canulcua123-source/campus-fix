// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
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
  vi.useRealTimers()
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

function UbicacionActual() {
  const ubicacion = useLocation()
  return <output data-testid="ubicacion">{`${ubicacion.pathname}${ubicacion.search}`}</output>
}

function renderConBarra() {
  prepararUsuario()
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<UbicacionActual />} />
            <Route path="buscar" element={<><UbicacionActual /><Buscar /></>} />
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
  it('aplica debounce de 300 ms antes de navegar a la búsqueda', () => {
    vi.useFakeTimers()
    responder(RESULTADOS)
    renderConBarra()
    const barra = screen.getByLabelText('Buscar incidencias')

    fireEvent.change(barra, { target: { value: 're' } })
    act(() => { vi.advanceTimersByTime(299) })
    expect(screen.getByTestId('ubicacion')).toHaveTextContent('/')
    expect(screen.getByTestId('ubicacion')).not.toHaveTextContent('/buscar')

    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.getByTestId('ubicacion')).toHaveTextContent('/buscar?q=re')
  })

  it('no navega con menos de dos caracteres', () => {
    vi.useFakeTimers()
    responder(RESULTADOS)
    renderConBarra()

    fireEvent.change(screen.getByLabelText('Buscar incidencias'), { target: { value: 'r' } })
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.getByTestId('ubicacion')).not.toHaveTextContent('/buscar')
  })

  it('conserva el foco y el texto al seguir escribiendo después del debounce', () => {
    vi.useFakeTimers()
    responder(RESULTADOS)
    renderConBarra()
    const barra = screen.getByLabelText('Buscar incidencias')
    barra.focus()

    fireEvent.change(barra, { target: { value: 're' } })
    act(() => { vi.advanceTimersByTime(300) })
    expect(screen.getByTestId('ubicacion')).toHaveTextContent('/buscar?q=re')

    // El mismo input sigue montado, enfocado y con su texto: se puede seguir escribiendo.
    expect(barra).toBeInTheDocument()
    expect(barra).toHaveFocus()
    expect(barra).toHaveValue('re')
    fireEvent.change(barra, { target: { value: 'red' } })
    expect(barra).toHaveValue('red')

    act(() => { vi.advanceTimersByTime(300) })
    expect(screen.getByTestId('ubicacion')).toHaveTextContent('/buscar?q=red')
    expect(barra).toHaveFocus()
    expect(barra).toHaveValue('red')
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

    expect(await screen.findByRole('searchbox', { name: 'Buscar incidencias' })).toHaveValue('r')
    expect(screen.getByRole('button', { name: 'Buscar' })).toBeDisabled()
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

  it('muestra el estado de carga mientras busca', async () => {
    let liberar!: () => void
    const espera = new Promise<void>((r) => { liberar = r })
    servidor.use(http.get(`${BASE}/incidencias/buscar`, async () => { await espera; return HttpResponse.json(RESULTADOS) }))
    renderBuscar()

    expect(await screen.findByRole('status', { name: 'Buscando incidencias' })).toBeInTheDocument()
    liberar()
    expect(await screen.findByRole('link', { name: /Red sin conexión/i })).toBeInTheDocument()
  })

  it('muestra un error con opción de reintentar si la búsqueda falla', async () => {
    servidor.use(http.get(`${BASE}/incidencias/buscar`, () => HttpResponse.json({ error: 'servidor' }, { status: 500 })))
    renderBuscar()

    expect(await screen.findByText('No pudimos realizar la búsqueda')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument()
  })

  it('avisa cuando el backend devuelve el máximo de 20 resultados', async () => {
    const veinte = Array.from({ length: 20 }, (_, i) => ({ ...RESULTADOS[0], _id: `r${i}`, codigo: `INC-${i}` }))
    responder(veinte)
    renderBuscar()

    expect(await screen.findByText(/Mostrando los 20 resultados más relevantes/)).toBeInTheDocument()
  })

  it('no muestra el aviso de máximo con menos de 20 resultados', async () => {
    responder(RESULTADOS)
    renderBuscar()

    await screen.findByRole('link', { name: /Red sin conexión/i })
    expect(screen.queryByText(/Mostrando los 20/)).not.toBeInTheDocument()
  })

  it('resalta palabras completas sin distinguir acentos ni mayúsculas', async () => {
    responder([{ ...RESULTADOS[0], titulo: 'Redes sin conexión en Predeterminado', ubicacion: { edificio: 'A', aula: 'R-2' } }])
    const { container } = renderBuscar('/buscar?q=RED conexion')

    await screen.findByRole('link')
    expect(Array.from(container.querySelectorAll('mark')).map((m) => m.textContent)).toEqual(['Redes', 'conexión'])
  })
})
