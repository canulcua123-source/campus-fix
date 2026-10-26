// @vitest-environment jsdom
import '../../test/setup'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { RequirePermiso } from '../RequirePermiso'
import { useAuth } from '../store'

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
  it('oculta ruta sin permiso', () => {
    useAuth.setState({ token: 't', usuario })
    montar('/bandeja')
    expect(screen.queryByText('Bandeja secreta')).not.toBeInTheDocument()
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
