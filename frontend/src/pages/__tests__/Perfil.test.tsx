// @vitest-environment jsdom
import '../../test/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { BASE } from '../../api/client'
import { useAuth } from '../../auth/store'
import { CLAVE_TEMA } from '../../lib/tema'
import { servidor } from '../../test/msw/server'
import Perfil from '../Perfil'
import Privacidad from '../Privacidad'

function montar(ruta: string) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route path="/perfil" element={<Perfil />} />
          <Route path="/privacidad" element={<Privacidad />} />
          <Route path="/login" element={<p>Pantalla de login</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Perfil (T-058)', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
    useAuth.setState({
      token: 'token-sintetico-t058',
      usuario: { nombre: 'Ana Reportante', rol: 'reportante', alcance: 'propio', permisos: ['incidencias:crear'] },
    })
    servidor.use(http.get(`${BASE}/auth/me`, () => HttpResponse.json({
      _id: '0123456789abcdef01234567', nombre: 'Ana Reportante', correo: 'ana@e2e.local', rol: 'reportante', alcance: 'propio', permisos: ['incidencias:crear'],
    })))
  })

  it('muestra los datos de /auth/me', async () => {
    montar('/perfil')
    expect(await screen.findByText('ana@e2e.local')).toBeInTheDocument()
    expect(screen.getByText('Solo tus reportes')).toBeInTheDocument()
  })

  it('muestra error con reintento si /auth/me falla', async () => {
    servidor.use(http.get(`${BASE}/auth/me`, () => HttpResponse.json({ detail: 'falla' }, { status: 500 })))
    montar('/perfil')
    expect(await screen.findByRole('button', { name: /reintentar/i })).toBeInTheDocument()
  })

  it('cambia y guarda el tema', async () => {
    const usuario = userEvent.setup()
    montar('/perfil')
    expect(screen.getByRole('button', { name: 'Automático' })).toHaveAttribute('aria-pressed', 'true')
    await usuario.click(screen.getByRole('button', { name: 'Oscuro' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem(CLAVE_TEMA)).toBe('oscuro')
    expect(screen.getByRole('button', { name: 'Oscuro' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('cierra sesión y vuelve al login', async () => {
    const usuario = userEvent.setup()
    montar('/perfil')
    await usuario.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    expect(await screen.findByText('Pantalla de login')).toBeInTheDocument()
    expect(useAuth.getState().token).toBeNull()
  })

  it('el aviso de privacidad se abre sin sesión', () => {
    useAuth.setState({ token: null, usuario: null })
    montar('/privacidad')
    expect(screen.getByRole('heading', { level: 1, name: 'Aviso de privacidad' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /iniciar sesión/i })).toHaveAttribute('href', '/login')
  })
})
