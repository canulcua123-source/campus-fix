// @vitest-environment jsdom
import '../../test/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { ACCESO_RUTA, cumpleAcceso, rutaInicio, type RutaApp } from '../../components/navegacion'
import { ROLES_BASE, sesionDe, type RolBase } from '../../test/roles'
import { RequirePermiso, SiPermiso } from '../RequirePermiso'
import { useAuth } from '../store'

// El registro del service worker no existe fuera de Vite.
vi.mock('../../components/UpdatePrompt', () => ({ UpdatePrompt: () => null }))

function Ruta() {
  return <output data-testid="ruta">{useLocation().pathname}</output>
}

const usuario = { nombre: 'Ana', rol: 'reportante', permisos: ['incidencias:crear', 'incidencias:ver'], alcance: 'propio' as const }

function montar(ruta: string) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/login" element={<p>Pantalla de login</p>} />
        <Route path="/" element={<RequirePermiso><p>Inicio</p></RequirePermiso>} />
        <Route path="/bandeja" element={<RequirePermiso permiso="seguimiento:registrar"><p>Bandeja secreta</p></RequirePermiso>} />
        <Route path="/reportar" element={<RequirePermiso permiso="incidencias:crear"><p>Reportar</p></RequirePermiso>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequirePermiso', () => {
  it('sin permiso no muestra la ruta y lleva a la pantalla principal del rol', () => {
    useAuth.setState({ token: 't', usuario })
    montar('/bandeja')
    expect(screen.queryByText('Bandeja secreta')).not.toBeInTheDocument()
    expect(screen.getByText('Inicio')).toBeInTheDocument()
  })

  it('SiPermiso oculta acciones sin permiso', () => {
    useAuth.setState({ token: 't', usuario })
    render(<>
      <SiPermiso permiso="incidencias:crear"><button type="button">Crear</button></SiPermiso>
      <SiPermiso permiso="roles:gestionar" alternativa={<p>Solo lectura</p>}><button type="button">Borrar rol</button></SiPermiso>
    </>)
    expect(screen.getByRole('button', { name: 'Crear' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Borrar rol' })).not.toBeInTheDocument()
    expect(screen.getByText('Solo lectura')).toBeInTheDocument()
  })

  // Toda ruta de la matriz abierta por URL sin permiso redirige a la pantalla principal del rol, nunca la muestra.
  const casos = (Object.keys(ROLES_BASE) as RolBase[]).flatMap((rol) =>
    (Object.keys(ACCESO_RUTA) as RutaApp[])
      .filter((ruta) => !cumpleAcceso(ACCESO_RUTA[ruta], ROLES_BASE[rol].permisos, rol))
      .map((ruta) => [rol, ruta.replace(':id', 'abc123')] as const))

  it.each(casos)('bloquea ruta por url (%s → %s)', (rol, ruta) => {
    useAuth.setState({ token: 't', usuario: sesionDe(rol) })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[ruta]}><App /><Ruta /></MemoryRouter>
      </QueryClientProvider>,
    )
    const inicio = rutaInicio(ROLES_BASE[rol].permisos, rol)
    expect(screen.getByTestId('ruta')).toHaveTextContent(new RegExp(`^${inicio}$`))
    expect(inicio).not.toBe(ruta)
  })

  it('ruta inexistente muestra «Página no encontrada»', () => {
    useAuth.setState({ token: 't', usuario: sesionDe('admin') })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/no-existe']}><App /></MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByRole('heading', { name: 'Página no encontrada' })).toBeInTheDocument()
  })

  it('muestra la ruta con permiso', () => {
    useAuth.setState({ token: 't', usuario })
    montar('/reportar')
    expect(screen.getByText('Reportar')).toBeInTheDocument()
  })

  it('sin sesión lleva a login', () => {
    montar('/reportar')
    expect(screen.getByText('Pantalla de login')).toBeInTheDocument()
  })

  it('espera el refresh silencioso antes de mandar a login', () => {
    useAuth.setState({ restaurando: true })
    montar('/reportar')
    expect(screen.queryByText('Pantalla de login')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Recuperando tu sesión')
  })
})
