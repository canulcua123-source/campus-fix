// @vitest-environment jsdom
import '../test/setup'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ROLES_BASE, type RolBase } from '../test/roles'
import { CLAVE_GRUPOS_MENU, NavegacionLateral } from './AppShell'

vi.mock('./UpdatePrompt', () => ({ UpdatePrompt: () => null }))

function montar(rol: RolBase, ruta = '/control') {
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <NavegacionLateral permisos={ROLES_BASE[rol].permisos} rol={rol} />
    </MemoryRouter>,
  )
  return screen.getByRole('navigation', { name: 'Secciones' })
}

const boton = (nav: HTMLElement, nombre: string) => within(nav).getByRole('button', { name: nombre })

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('NavegacionLateral', () => {
  it('superadmin: encabezados de sección y grupos plegables cerrados por defecto', () => {
    const nav = montar('superadmin')
    expect(within(nav).getByText('Operación')).toBeInTheDocument()
    expect(within(nav).getByText('Análisis')).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Centro de control' })).toBeInTheDocument()
    expect(boton(nav, 'Administración')).toHaveAttribute('aria-expanded', 'false')
    expect(boton(nav, 'Sistema')).toHaveAttribute('aria-expanded', 'false')
    expect(within(nav).queryByRole('link', { name: 'Usuarios' })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: 'Configuración' })).not.toBeInTheDocument()
  })

  it('abre/cierra un grupo con el botón y recuerda el estado', async () => {
    const usuario = userEvent.setup()
    const nav = montar('superadmin')
    const admin = boton(nav, 'Administración')
    await usuario.click(admin)
    expect(admin).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById(admin.getAttribute('aria-controls')!)).toBeVisible()
    expect(within(nav).getByRole('link', { name: 'Roles' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(CLAVE_GRUPOS_MENU)!)).toMatchObject({ Administración: true })
    await usuario.click(admin)
    expect(admin).toHaveAttribute('aria-expanded', 'false')
    expect(JSON.parse(localStorage.getItem(CLAVE_GRUPOS_MENU)!)).toMatchObject({ Administración: false })
  })

  it('el grupo que contiene la ruta activa arranca abierto', () => {
    localStorage.setItem(CLAVE_GRUPOS_MENU, JSON.stringify({ Sistema: false }))
    const nav = montar('superadmin', '/admin/configuracion')
    expect(boton(nav, 'Sistema')).toHaveAttribute('aria-expanded', 'true')
    expect(within(nav).getByRole('link', { name: 'Configuración' })).toHaveAttribute('aria-current', 'page')
    expect(boton(nav, 'Administración')).toHaveAttribute('aria-expanded', 'false')
  })

  it('al navegar a una pantalla de un grupo cerrado, el grupo se abre', async () => {
    render(
      <MemoryRouter initialEntries={['/control']}>
        <Link to="/admin/roles">Ir a roles</Link>
        <NavegacionLateral permisos={ROLES_BASE.superadmin.permisos} rol="superadmin" />
      </MemoryRouter>,
    )
    const nav = screen.getByRole('navigation', { name: 'Secciones' })
    expect(boton(nav, 'Administración')).toHaveAttribute('aria-expanded', 'false')
    await userEvent.setup().click(screen.getByRole('link', { name: 'Ir a roles' }))
    expect(boton(nav, 'Administración')).toHaveAttribute('aria-expanded', 'true')
    expect(within(nav).getByRole('link', { name: 'Roles' })).toHaveAttribute('aria-current', 'page')
  })

  it('restaura grupos abiertos guardados', () => {
    localStorage.setItem(CLAVE_GRUPOS_MENU, JSON.stringify({ Administración: true }))
    expect(boton(montar('superadmin'), 'Administración')).toHaveAttribute('aria-expanded', 'true')
  })

  it('si localStorage lanza, usa los valores por defecto sin romper', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado') })
    expect(boton(montar('superadmin'), 'Sistema')).toHaveAttribute('aria-expanded', 'false')
  })

  it('admin ve la misma agrupación sin lo que no tiene', () => {
    const nav = montar('admin', '/dashboard')
    expect(within(nav).getByText('Análisis')).toBeInTheDocument()
    expect(within(nav).queryByText('Operación')).not.toBeInTheDocument()
    expect(boton(nav, 'Administración')).toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: 'Roles' })).not.toBeInTheDocument()
  })

  it('coordinador (pocos elementos) conserva el menú plano', () => {
    const nav = montar('coordinador', '/tablero')
    expect(within(nav).queryAllByRole('button')).toHaveLength(0)
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(['Tablero', 'Incidencias', 'Técnicos', 'Métricas'])
  })
})
