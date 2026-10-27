// @vitest-environment jsdom
import '../../test/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { BASE } from '../../api/client'
import { useAuth } from '../../auth/store'
import { servidor } from '../../test/msw/server'
import AdminEdificios from '../AdminEdificios'

const CATALOGO = [
  {
    edificio: 'Edificio A', total_aulas: 3, activas: 2, pisos: [0, 2],
    aulas: [
      { id_publico: 'AaaaaaaaaaaaaaaaaaaaA1', piso: 0, aula: 'A-001', activa: true },
      { id_publico: 'AaaaaaaaaaaaaaaaaaaaA2', piso: 2, aula: 'A-201', activa: true },
      { id_publico: 'AaaaaaaaaaaaaaaaaaaaA3', piso: 2, aula: 'A-202', activa: false },
    ],
  },
  {
    edificio: 'Biblioteca', total_aulas: 1, activas: 1, pisos: [1],
    aulas: [{ id_publico: 'BbbbbbbbbbbbbbbbbbbbB1', piso: 1, aula: 'Sala de lectura', activa: true }],
  },
]

function montar(respuesta: () => Response) {
  servidor.use(http.get(`${BASE}/aulas`, respuesta))
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={cliente}><MemoryRouter><AdminEdificios /></MemoryRouter></QueryClientProvider>)
}

describe('AdminEdificios', () => {
  beforeEach(() => {
    useAuth.setState({
      token: 'token-sintetico-edificios',
      usuario: { nombre: 'Admin', rol: 'admin', alcance: 'global', permisos: ['usuarios:gestionar'] },
    })
  })

  it('muestra skeleton y luego una tarjeta por edificio con conteos y aulas por piso', async () => {
    montar(() => HttpResponse.json(CATALOGO))
    expect(screen.getByRole('status', { name: 'Cargando edificios' })).toBeInTheDocument()
    const tarjeta = (await screen.findByRole('heading', { name: 'Edificio A' })).closest('li')!
    expect(within(tarjeta).getByText(/3 aulas · 2 activas · 1 inactiva · 2 pisos/)).toBeInTheDocument()
    await userEvent.setup().click(within(tarjeta).getByText('Ver aulas por piso'))
    const piso2 = within(tarjeta).getByRole('region', { name: 'Edificio A, Piso 2' })
    expect(within(piso2).getByText('A-202')).toBeInTheDocument()
    expect(within(piso2).getByText('Inactiva')).toBeInTheDocument()
    expect(within(tarjeta).getByRole('region', { name: 'Edificio A, Planta baja' })).toBeInTheDocument()
    expect(within(tarjeta).getByText('QR: AaaaaaaaaaaaaaaaaaaaA1')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Biblioteca' })).toBeInTheDocument()
  })

  it('filtra por edificio o aula y muestra sin resultados', async () => {
    const u = userEvent.setup()
    montar(() => HttpResponse.json(CATALOGO))
    const buscar = await screen.findByRole('searchbox', { name: 'Buscar edificio o aula' })
    await u.type(buscar, 'biblio')
    expect(screen.getByRole('heading', { name: 'Biblioteca' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Edificio A' })).not.toBeInTheDocument()
    await u.clear(buscar)
    await u.type(buscar, 'a-20')
    expect(screen.getByText('Aulas encontradas (2)')).toBeInTheDocument()
    expect(screen.queryByText('A-001')).not.toBeInTheDocument()
    await u.clear(buscar)
    await u.type(buscar, 'zzz')
    expect(screen.getByRole('heading', { name: 'Sin resultados' })).toBeInTheDocument()
  })

  it('muestra estado vacío', async () => {
    montar(() => HttpResponse.json([]))
    expect(await screen.findByRole('heading', { name: 'Aún no hay aulas registradas' })).toBeInTheDocument()
  })

  it('muestra error con reintentar', async () => {
    let llamadas = 0
    montar(() => (++llamadas === 1 ? HttpResponse.json({ detail: 'falla' }, { status: 500 }) : HttpResponse.json(CATALOGO)))
    await userEvent.setup().click(await screen.findByRole('button', { name: /Reintentar/ }))
    expect(await screen.findByRole('heading', { name: 'Edificio A' })).toBeInTheDocument()
  })
})
