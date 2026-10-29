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
import Bandeja from '../Bandeja'

const INCIDENCIAS: IncidenciaListaItem[] = [
  {
    _id: 'baja', codigo: 'INC-BAJA', titulo: 'Baja antigua', categoria: 'infraestructura', estado: 'abierta', prioridad: 'baja',
    ubicacion: { edificio: 'B', aula: 'B-101' }, tags: [], fecha_creacion: '2026-10-20T08:00:00Z',
    tecnico_asignado: { usuario_id: 'u-ana', nombre: 'Ana' },
  },
  {
    _id: 'alta-reciente', codigo: 'INC-ALTA-2', titulo: 'Alta reciente', categoria: 'computo_redes', estado: 'abierta', prioridad: 'alta',
    ubicacion: { edificio: 'A', aula: 'A-101' }, tags: [], fecha_creacion: '2026-10-22T08:00:00Z',
    tecnico_asignado: { usuario_id: 'u-ana', nombre: 'Ana' },
  },
  {
    _id: 'critica', codigo: 'INC-CRITICA', titulo: 'Crítica asignada', categoria: 'computo_redes', estado: 'abierta', prioridad: 'critica',
    ubicacion: { edificio: 'A', aula: 'A-102' }, tags: [], fecha_creacion: '2026-10-22T08:00:00Z',
    tecnico_asignado: { usuario_id: 'u-ana', nombre: 'Ana' },
  },
  {
    _id: 'alta-antigua', codigo: 'INC-ALTA-1', titulo: 'Alta antigua', categoria: 'academico', estado: 'abierta', prioridad: 'alta',
    ubicacion: { edificio: 'C', aula: 'C-101' }, tags: [], fecha_creacion: '2026-10-21T08:00:00Z',
    tecnico_asignado: { usuario_id: 'u-ana', nombre: 'Ana' },
  },
  {
    _id: 'sin-asignar', codigo: 'INC-SIN', titulo: 'Pendiente de asignación', categoria: 'infraestructura', estado: 'abierta', prioridad: 'media',
    ubicacion: { edificio: 'A', aula: 'A-103' }, tags: [], fecha_creacion: '2026-10-21T08:00:00Z',
  },
  {
    _id: 'otro-tecnico', codigo: 'INC-OTRO', titulo: 'Asignada a Luis', categoria: 'infraestructura', estado: 'abierta', prioridad: 'critica',
    ubicacion: { edificio: 'A', aula: 'A-104' }, tags: [], fecha_creacion: '2026-10-20T08:00:00Z',
    tecnico_asignado: { usuario_id: 'u-luis', nombre: 'Luis' },
  },
]

function Ubicacion() {
  const { search } = useLocation()
  return <output data-testid="url">{search}</output>
}

function renderBandeja(ruta = '/bandeja') {
  const sesion = { nombre: 'Ana', rol: 'tecnico', permisos: ['incidencias:ver', 'incidencias:crear', 'seguimiento:registrar'], alcance: 'area' as const }
  useAuth.setState({ token: 'token-prueba', usuario: sesion })
  servidor.use(http.get(`${BASE}/auth/me`, () => HttpResponse.json({ _id: 'u-ana', ...sesion })))
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[ruta]}><Bandeja /><Ubicacion /></MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Reportada por Ana fuera de lo asignado (solo llega con ?propias=true en la lista de esta prueba). */
const REPORTADA: IncidenciaListaItem = {
  _id: 'reportada', codigo: 'INC-REP', titulo: 'Fuga reportada por mí', categoria: 'infraestructura', estado: 'en_proceso', prioridad: 'media',
  ubicacion: { edificio: 'D', aula: 'D-201' }, tags: [], fecha_creacion: '2026-10-23T08:00:00Z',
  tecnico_asignado: { usuario_id: 'u-luis', nombre: 'Luis' },
}

/** Responde la lista general y, con ?propias=true, solo las reportadas por la persona. */
function responder(lista: IncidenciaListaItem[], propias: IncidenciaListaItem[] = []) {
  servidor.use(http.get(`${BASE}/incidencias`, ({ request }) =>
    HttpResponse.json(new URL(request.url).searchParams.get('propias') === 'true' ? propias : lista)))
}

const nombres = (lista: string) => within(screen.getByRole('list', { name: lista })).getAllByRole('link').map((a) => a.textContent)
const chip = (nombre: RegExp) => screen.getByRole('radio', { name: nombre })

describe('Mis incidencias del técnico (T-050)', () => {
  it('«Asignadas a mí» ordena por prioridad y antigüedad', async () => {
    responder(INCIDENCIAS)
    renderBandeja('/bandeja?vista=asignadas')

    await screen.findByText('Crítica asignada')
    expect(nombres('Asignadas a mí')).toEqual([
      expect.stringContaining('Crítica asignada'),
      expect.stringContaining('Alta antigua'),
      expect.stringContaining('Alta reciente'),
      expect.stringContaining('Baja antigua'),
    ])
    expect(screen.getAllByText('Aceptada por ti')).toHaveLength(4)
  })

  it('«Todas» une la bandeja y lo reportado, sin duplicar, con el conteo de cada filtro', async () => {
    const yaVisible = INCIDENCIAS[4]
    responder([...INCIDENCIAS, REPORTADA], [REPORTADA, yaVisible])
    renderBandeja()

    await screen.findByText('Crítica asignada')
    expect(chip(/^Todas/)).toHaveAttribute('aria-checked', 'true')
    expect(chip(/^Todas/)).toHaveTextContent('7')
    expect(chip(/^Asignadas a mí/)).toHaveTextContent('4')
    expect(chip(/^Por tomar/)).toHaveTextContent('1')
    expect(chip(/^Reportadas por mí/)).toHaveTextContent('2')
    expect(chip(/^Resueltas/)).toHaveTextContent('0')
    expect(screen.getAllByText('Pendiente de asignación')).toHaveLength(1)
  })

  it('cada filtro filtra de verdad y queda en la URL', async () => {
    const resuelta = { ...INCIDENCIAS[0], _id: 'res', codigo: 'INC-RES', titulo: 'Ya resuelta', estado: 'resuelta' as const }
    responder([...INCIDENCIAS, resuelta], [REPORTADA])
    renderBandeja()
    const usuario = userEvent.setup()
    await screen.findByText('Crítica asignada')

    await usuario.click(chip(/^Por tomar/))
    expect(nombres('Por tomar')).toEqual([expect.stringContaining('Pendiente de asignación')])
    expect(screen.getByRole('button', { name: 'Tomar INC-SIN' })).toBeInTheDocument()
    expect(screen.getByTestId('url')).toHaveTextContent('?vista=por_tomar')

    await usuario.click(chip(/^Reportadas por mí/))
    expect(nombres('Reportadas por mí')).toEqual([expect.stringContaining('Fuga reportada por mí')])
    expect(screen.getByText('Luis')).toBeInTheDocument()
    expect(screen.getByTestId('url')).toHaveTextContent('?vista=reportadas')

    await usuario.click(chip(/^Resueltas/))
    expect(nombres('Resueltas')).toEqual([expect.stringContaining('Ya resuelta')])
    expect(screen.getByText(/Esperando confirmación del reportante/)).toBeInTheDocument()

    await usuario.click(chip(/^Asignadas a mí/))
    expect(nombres('Asignadas a mí')).toHaveLength(4)
    expect(screen.queryByText('Ya resuelta')).not.toBeInTheDocument()
    expect(screen.queryByText('Asignada a Luis')).not.toBeInTheDocument()

    await usuario.click(chip(/^Todas/))
    expect(screen.getByTestId('url')).toHaveTextContent(/^$/)
    expect(nombres('Todas')).toHaveLength(8)
  })

  it('las flechas del teclado cambian de filtro', async () => {
    responder(INCIDENCIAS)
    renderBandeja()
    const usuario = userEvent.setup()
    await screen.findByText('Crítica asignada')

    chip(/^Todas/).focus()
    await usuario.keyboard('{ArrowRight}')
    expect(chip(/^Asignadas a mí/)).toHaveAttribute('aria-checked', 'true')
    expect(chip(/^Asignadas a mí/)).toHaveFocus()
    await usuario.keyboard('{End}')
    expect(screen.getByTestId('url')).toHaveTextContent('?vista=resueltas')
  })

  it('lee vista y estado de la URL y filtra por estado', async () => {
    const enProceso = { ...INCIDENCIAS[0], _id: 'proc', codigo: 'INC-PROC', titulo: 'En trabajo', estado: 'en_proceso' as const }
    responder([...INCIDENCIAS, enProceso])
    renderBandeja('/bandeja?vista=asignadas&estado=en_proceso')

    expect(await screen.findByText('En trabajo')).toBeInTheDocument()
    expect(screen.queryByText('Crítica asignada')).not.toBeInTheDocument()
    expect(chip(/^En proceso/)).toHaveAttribute('aria-checked', 'true')

    await userEvent.setup().click(chip(/^Todos/))
    expect(screen.getByText('Crítica asignada')).toBeInTheDocument()
    expect(screen.getByTestId('url')).toHaveTextContent('?vista=asignadas')
  })

  it('estado vacío propio de «Asignadas a mí» con acceso a «Por tomar»', async () => {
    responder([INCIDENCIAS[4]])
    renderBandeja('/bandeja?vista=asignadas')

    expect(await screen.findByText('No tienes incidencias asignadas')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ver por tomar' }))
    expect(nombres('Por tomar')).toEqual([expect.stringContaining('Pendiente de asignación')])
  })

  it('estado vacío de «Reportadas por mí» ofrece reportar', async () => {
    responder(INCIDENCIAS)
    renderBandeja('/bandeja?vista=reportadas')

    expect(await screen.findByText('No has reportado incidencias')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Reportar' })).toHaveAttribute('href', '/reportar')
  })

  it('muestra «Todo al día» si no hay nada', async () => {
    responder([])
    renderBandeja()

    expect(await screen.findByText('Todo al día')).toBeInTheDocument()
  })

  it('«Asignadas a mí» usa el id del usuario y no confunde homónimos', async () => {
    const base = INCIDENCIAS[0]
    responder([
      { ...base, _id: 'mia', codigo: 'INC-MIA', titulo: 'Mía de verdad' },
      { ...base, _id: 'homonimo', codigo: 'INC-HOMONIMO', titulo: 'De otra Ana', tecnico_asignado: { usuario_id: 'u-otra-ana', nombre: 'Ana' } },
    ])
    renderBandeja('/bandeja?vista=asignadas')

    await screen.findByText('Mía de verdad')
    expect(screen.queryByText('De otra Ana')).not.toBeInTheDocument()
  })

  it('las cerradas no cuentan como resueltas pendientes', async () => {
    const base = INCIDENCIAS[0]
    responder([
      { ...base, _id: 'resuelta', codigo: 'INC-RES', titulo: 'Ya resuelta', estado: 'resuelta' },
      { ...base, _id: 'cerrada', codigo: 'INC-CER', titulo: 'Ya cerrada', estado: 'cerrada' },
    ])
    renderBandeja('/bandeja?vista=resueltas')

    expect(await screen.findByText('Ya resuelta')).toBeInTheDocument()
    expect(screen.queryByText('Ya cerrada')).not.toBeInTheDocument()
  })

  it('busca por título, folio o aula sin importar acentos y permite limpiar', async () => {
    responder(INCIDENCIAS)
    renderBandeja()
    const usuario = userEvent.setup()
    await screen.findByText('Crítica asignada')
    const buscador = screen.getByRole('searchbox', { name: 'Buscar en mis incidencias' })

    await usuario.type(buscador, 'CRITICA')
    expect(screen.getByText('Crítica asignada')).toBeInTheDocument()
    expect(screen.queryByText('Alta antigua')).not.toBeInTheDocument()

    await usuario.clear(buscador)
    await usuario.type(buscador, 'INC-SIN')
    expect(nombres('Todas')).toEqual([expect.stringContaining('Pendiente de asignación')])
    expect(chip(/^Por tomar/)).toHaveTextContent('1')
    expect(chip(/^Asignadas a mí/)).toHaveTextContent('0')

    await usuario.clear(buscador)
    await usuario.type(buscador, 'no existe nada')
    expect(screen.getByText('Sin coincidencias')).toBeInTheDocument()
    await usuario.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }))
    expect(buscador).toHaveValue('')
    expect(screen.getByText('Alta antigua')).toBeInTheDocument()
  })

  it('muestra un error con reintento si no carga', async () => {
    servidor.use(http.get(`${BASE}/incidencias`, () => HttpResponse.json({ error: 'servidor' }, { status: 500 })))
    renderBandeja()

    expect(await screen.findByText('No pudimos cargar tus incidencias')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('el técnico toma una incidencia sin asignar', async () => {
    let tomada = false
    servidor.use(
      http.get(`${BASE}/incidencias`, ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('propias') ? [] : tomada
        ? INCIDENCIAS.map((i) => (i._id === 'sin-asignar' ? { ...i, tecnico_asignado: { usuario_id: 'u-ana', nombre: 'Ana' } } : i))
        : INCIDENCIAS)),
      http.post(`${BASE}/incidencias/sin-asignar/tomar`, () => {
        tomada = true
        return HttpResponse.json({ ok: true, estado: 'abierta', tecnico_asignado: { usuario_id: 'u-ana', nombre: 'Ana' } })
      }),
    )
    renderBandeja('/bandeja?vista=por_tomar')
    const usuario = userEvent.setup()
    await usuario.click(await screen.findByRole('button', { name: 'Tomar INC-SIN' }))
    expect(await screen.findByText(/Tomaste INC-SIN/)).toBeInTheDocument()
    expect(await screen.findByText('No hay incidencias por tomar')).toBeInTheDocument()
    await usuario.click(chip(/^Asignadas a mí/))
    expect(within(screen.getByRole('list', { name: 'Asignadas a mí' })).getByText('Pendiente de asignación')).toBeInTheDocument()
  })

  it('muestra el 409 cuando otro técnico la tomó antes y refresca la lista', async () => {
    let listas = 0
    servidor.use(
      http.get(`${BASE}/incidencias`, () => {
        listas += 1
        return HttpResponse.json(INCIDENCIAS)
      }),
      http.post(`${BASE}/incidencias/sin-asignar/tomar`, () =>
        HttpResponse.json({ detail: 'La incidencia no está disponible para autoasignación' }, { status: 409 })),
    )
    renderBandeja()
    const usuario = userEvent.setup()
    await usuario.click(await screen.findByRole('button', { name: 'Tomar INC-SIN' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('La incidencia no está disponible para autoasignación')
    await waitFor(() => expect(listas).toBeGreaterThan(2))
  })

  it('no ofrece "Tomar" a un coordinador', async () => {
    responder(INCIDENCIAS)
    renderBandeja('/bandeja?vista=por_tomar')
    useAuth.setState({ usuario: { nombre: 'Ana', rol: 'coordinador', permisos: ['incidencias:ver', 'seguimiento:registrar'], alcance: 'area' } })
    await screen.findByText('Pendiente de asignación')
    expect(screen.queryByRole('button', { name: /Tomar/ })).not.toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Por tomar' })).getByText('Por aceptar')).toBeInTheDocument()
  })
})
