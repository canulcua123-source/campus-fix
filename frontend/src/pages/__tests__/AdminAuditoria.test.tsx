// @vitest-environment jsdom
import '../../test/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { BASE } from '../../api/client'
import { useAuth } from '../../auth/store'
import type { PaginaAuditoria } from '../../schemas/auditoria'
import { servidor } from '../../test/msw/server'
import AdminAuditoria from '../AdminAuditoria'

const RESPUESTA: PaginaAuditoria = {
  pagina: 1,
  limite: 20,
  total: 45,
  resultados: [
    {
      _id: 'ev1', actor_id: 'admin1', accion: 'editar', recurso: 'usuarios', recurso_id: 'u1',
      antes: { rol: 'reportante', activo: true, areas: [] },
      despues: { rol: 'tecnico', activo: false, areas: ['redes'] },
      fecha: '2026-10-25T18:30:00Z',
    },
    {
      _id: 'ev2', actor_id: 'admin1', accion: 'crear', recurso: 'categorias', recurso_id: 'c1',
      despues: { clave: 'mobiliario', version: 1, sistema: false },
      fecha: '2026-10-24T10:00:00Z',
    },
  ],
}

function preparar(manejador: (url: URL) => Response, cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const urls: URL[] = []
  servidor.use(http.get(`${BASE}/auditoria`, ({ request }) => {
    const url = new URL(request.url)
    urls.push(url)
    return manejador(url)
  }))
  useAuth.setState({
    token: 'token-admin',
    usuario: { nombre: 'Superadministradora', rol: 'superadmin', alcance: 'global', permisos: ['usuarios:gestionar', 'sistema:administrar'] },
  })
  render(<QueryClientProvider client={cliente}><MemoryRouter><AdminAuditoria /></MemoryRouter></QueryClientProvider>)
  return urls
}

describe('Auditoría administrativa', () => {
  it('muestra skeleton y luego una línea de tiempo por día con texto legible y diff antes → después', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-26T18:00:00Z') })
    try {
      preparar(() => HttpResponse.json(RESPUESTA))
      expect(screen.getByRole('status', { name: 'Cargando eventos de auditoría' })).toBeInTheDocument()
      await screen.findByRole('list', { name: 'Eventos de auditoría' })
      expect(screen.getByRole('heading', { name: 'Ayer' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Sábado, 24 de octubre de 2026' })).toBeInTheDocument()
      const edicion = within(screen.getByRole('list', { name: 'Eventos de Ayer' })).getByRole('listitem')
      expect(edicion).toHaveTextContent('Editó el usuario u1')
      expect(edicion).toHaveTextContent('Admin admin1')
      expect(edicion).toHaveTextContent('hace 23 horas')
      expect(edicion).toHaveTextContent('reportante')
      expect(edicion).toHaveTextContent('tecnico')
      expect(edicion).toHaveTextContent('ActivoSí')
      expect(edicion).toHaveTextContent('redes')
      expect(within(edicion).getByText('25 oct 2026', { exact: false })).toBeInTheDocument()
      const creacion = within(screen.getByRole('list', { name: /Eventos de Sábado/ })).getByRole('listitem')
      expect(creacion).toHaveTextContent('Creó la categoría mobiliario')
      expect(screen.getByText('1–2 de 45')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('describe altas y ediciones de aulas con su ubicación', async () => {
    preparar(() => HttpResponse.json({
      pagina: 1, limite: 20, total: 2,
      resultados: [
        {
          _id: 'ev3', actor_id: 'admin1', accion: 'editar', recurso: 'aulas', recurso_id: 'AbCdEfGhIjKlMnOpQrStUv',
          antes: { edificio: 'Edificio A', piso: 2, aula: 'A-201', activa: true },
          despues: { edificio: 'Edificio A', piso: 2, aula: 'A-201', activa: false },
          fecha: '2026-10-25T18:30:00Z',
        },
        {
          _id: 'ev4', actor_id: 'admin1', accion: 'crear', recurso: 'aulas', recurso_id: 'ZyXwVuTsRqPoNmLkJiHgFe',
          despues: { edificio: 'Biblioteca', piso: 0, aula: 'Sala 1', activa: true },
          fecha: '2026-10-24T10:00:00Z',
        },
      ],
    } satisfies PaginaAuditoria))
    expect(await screen.findByText(/A-201 · Edificio A/)).toBeInTheDocument()
    const [edicion, alta] = screen.getAllByRole('listitem', { name: /el aula/ })
    expect(edicion).toHaveTextContent('Editó el aula A-201 · Edificio A')
    expect(edicion).toHaveTextContent('ActivaSí')
    expect(edicion).toHaveTextContent('No')
    expect(alta).toHaveTextContent('Creó el aula Sala 1 · Biblioteca')
    expect(screen.getByRole('button', { name: 'Aulas' })).toBeInTheDocument()
  })

  it('muestra nombres de usuarios ya en caché en lugar de ids', async () => {
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    cliente.setQueryData(['usuarios'], [
      { _id: 'admin1', nombre: 'Ana Admin', correo: 'ana@utm.mx', rol: 'admin' },
      { _id: 'u1', nombre: 'Luis Pérez', correo: 'luis@utm.mx', rol: 'tecnico' },
    ])
    preparar(() => HttpResponse.json(RESPUESTA), cliente)
    await screen.findByRole('list', { name: 'Eventos de auditoría' })
    expect(screen.getByText('Luis Pérez')).toBeInTheDocument()
    expect(screen.getAllByText(/Ana Admin/).length).toBeGreaterThan(0)
  })

  it('filtra por recurso y pagina con Anterior/Siguiente', async () => {
    const urls = preparar((url) => HttpResponse.json({ ...RESPUESTA, pagina: Number(url.searchParams.get('pagina')) }))
    await screen.findByRole('list', { name: 'Eventos de auditoría' })
    expect(Object.fromEntries(urls[0].searchParams)).toEqual({ pagina: '1', limite: '20' })
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(await screen.findByText('21–22 de 45')).toBeInTheDocument()
    expect(urls.at(-1)?.searchParams.get('pagina')).toBe('2')
    await userEvent.click(within(screen.getByRole('group', { name: 'Recurso' })).getByRole('button', { name: 'Roles' }))
    await waitFor(() => expect(Object.fromEntries(urls.at(-1)!.searchParams)).toEqual({ pagina: '1', limite: '20', recurso: 'roles' }))
  })

  it('muestra estado vacío', async () => {
    preparar(() => HttpResponse.json({ pagina: 1, limite: 20, total: 0, resultados: [] }))
    expect(await screen.findByText('Sin eventos de auditoría')).toBeInTheDocument()
  })

  it('muestra error con Reintentar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    preparar(() => HttpResponse.json({ error: 'interno', detalle: 'No disponible' }, { status: 500 }))
    expect(await screen.findByText('No pudimos cargar la información')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })
})
