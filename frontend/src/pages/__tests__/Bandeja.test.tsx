// @vitest-environment jsdom
import '../../test/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
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

function renderBandeja() {
  const sesion = { nombre: 'Ana', rol: 'tecnico', permisos: ['incidencias:ver', 'seguimiento:registrar'], alcance: 'area' as const }
  useAuth.setState({ token: 'token-prueba', usuario: sesion })
  servidor.use(http.get(`${BASE}/auth/me`, () => HttpResponse.json({ _id: 'u-ana', ...sesion })))
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={cliente}><MemoryRouter><Bandeja /></MemoryRouter></QueryClientProvider>)
}

function responder(lista: IncidenciaListaItem[]) {
  servidor.use(http.get(`${BASE}/incidencias`, () => HttpResponse.json(lista)))
}

describe('Bandeja (T-050)', () => {
  it('ordena por prioridad y antigüedad', async () => {
    responder(INCIDENCIAS)
    renderBandeja()

    await screen.findByText('Crítica asignada')
    expect(screen.getAllByRole('link').map((enlace) => enlace.textContent)).toEqual([
      expect.stringContaining('Crítica asignada'),
      expect.stringContaining('Alta antigua'),
      expect.stringContaining('Alta reciente'),
      expect.stringContaining('Baja antigua'),
    ])
  })

  it('muestra en su pestaña las incidencias sin asignar', async () => {
    responder(INCIDENCIAS)
    renderBandeja()

    const usuario = userEvent.setup()
    await screen.findByText('Crítica asignada')
    await usuario.click(screen.getByRole('tab', { name: 'Sin asignar' }))
    expect(screen.getByText('Pendiente de asignación')).toBeInTheDocument()
    expect(screen.queryByText('Crítica asignada')).not.toBeInTheDocument()
  })

  it('muestra el estado vacío', async () => {
    responder([])
    renderBandeja()

    expect(await screen.findByText('Sin incidencias asignadas')).toBeInTheDocument()
  })

  it('"Mis asignadas" usa el id del usuario y no confunde homónimos', async () => {
    const base = INCIDENCIAS[0]
    responder([
      { ...base, _id: 'mia', codigo: 'INC-MIA', titulo: 'Mía de verdad' },
      { ...base, _id: 'homonimo', codigo: 'INC-HOMONIMO', titulo: 'De otra Ana', tecnico_asignado: { usuario_id: 'u-otra-ana', nombre: 'Ana' } },
    ])
    renderBandeja()

    await screen.findByText('Mía de verdad')
    expect(screen.queryByText('De otra Ana')).not.toBeInTheDocument()
  })

  it('no muestra incidencias resueltas ni cerradas', async () => {
    const base = INCIDENCIAS[0]
    responder([
      { ...base, _id: 'activa', codigo: 'INC-ACTIVA', titulo: 'En trabajo', estado: 'en_proceso' },
      { ...base, _id: 'resuelta', codigo: 'INC-RES', titulo: 'Ya resuelta', estado: 'resuelta' },
      { ...base, _id: 'cerrada', codigo: 'INC-CER', titulo: 'Ya cerrada', estado: 'cerrada' },
    ])
    renderBandeja()

    await screen.findByText('En trabajo')
    expect(screen.queryByText('Ya resuelta')).not.toBeInTheDocument()
    expect(screen.queryByText('Ya cerrada')).not.toBeInTheDocument()
  })

  it('muestra un error con reintento si la bandeja no carga', async () => {
    servidor.use(http.get(`${BASE}/incidencias`, () => HttpResponse.json({ error: 'servidor' }, { status: 500 })))
    renderBandeja()

    expect(await screen.findByText('No pudimos cargar la bandeja')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('el técnico toma una incidencia sin asignar', async () => {
    let tomada = false
    servidor.use(
      http.get(`${BASE}/incidencias`, () => HttpResponse.json(tomada
        ? INCIDENCIAS.map((i) => (i._id === 'sin-asignar' ? { ...i, tecnico_asignado: { usuario_id: 'u-ana', nombre: 'Ana' } } : i))
        : INCIDENCIAS)),
      http.post(`${BASE}/incidencias/sin-asignar/tomar`, () => {
        tomada = true
        return HttpResponse.json({ ok: true, estado: 'abierta', tecnico_asignado: { usuario_id: 'u-ana', nombre: 'Ana' } })
      }),
    )
    renderBandeja()
    const usuario = userEvent.setup()
    await screen.findByText('Crítica asignada')
    expect(screen.queryByRole('button', { name: /Tomar/ })).not.toBeInTheDocument()
    await usuario.click(screen.getByRole('tab', { name: 'Sin asignar' }))
    await usuario.click(screen.getByRole('button', { name: 'Tomar INC-SIN' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Tomaste INC-SIN')
    await waitFor(() => expect(screen.queryByText('Pendiente de asignación')).not.toBeInTheDocument())
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
    await screen.findByText('Crítica asignada')
    await usuario.click(screen.getByRole('tab', { name: 'Sin asignar' }))
    await usuario.click(screen.getByRole('button', { name: 'Tomar INC-SIN' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('La incidencia no está disponible para autoasignación')
    await waitFor(() => expect(listas).toBeGreaterThan(1))
  })

  it('no ofrece "Tomar" a un coordinador', async () => {
    responder(INCIDENCIAS)
    renderBandeja()
    useAuth.setState({ usuario: { nombre: 'Ana', rol: 'coordinador', permisos: ['incidencias:ver', 'seguimiento:registrar'], alcance: 'area' } })
    const usuario = userEvent.setup()
    await screen.findByText('Crítica asignada')
    await usuario.click(screen.getByRole('tab', { name: 'Sin asignar' }))
    expect(screen.queryByRole('button', { name: /Tomar/ })).not.toBeInTheDocument()
  })
})
