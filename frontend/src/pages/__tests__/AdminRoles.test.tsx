// @vitest-environment jsdom
import '../../test/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { BASE } from '../../api/client'
import { puedeOtorgar } from '../../api/usuarios'
import { useAuth } from '../../auth/store'
import type { Rol } from '../../schemas/usuario'
import { servidor } from '../../test/msw/server'
import { sesionDe } from '../../test/roles'
import AdminRoles from '../AdminRoles'

const URL_ROLES = `${BASE}/roles`
const SISTEMA: Rol = { _id: '664f1c2e9b1e8a3d4c5b6a01', clave: 'tecnico', nombre: 'Técnico', descripcion: 'Rol de sistema: Técnico', permisos: ['seguimiento:registrar'], alcance: 'area', sistema: true }
const ADMIN: Rol = {
  _id: '664f1c2e9b1e8a3d4c5b6a04', clave: 'admin', nombre: 'Administrador', descripcion: 'Rol de sistema: Administrador',
  permisos: [...sesionDe('admin').permisos], alcance: 'global', sistema: true,
}
const PROPIO: Rol = { _id: '664f1c2e9b1e8a3d4c5b6a02', clave: 'auxiliar', nombre: 'Auxiliar', descripcion: '', permisos: ['incidencias:ver'], alcance: 'propio', sistema: false }

function entorno(usuario = sesionDe('superadmin'), roles: Rol[] = [SISTEMA, PROPIO]) {
  const lista = [...roles]
  const peticiones: { metodo: string; cuerpo?: unknown }[] = []
  servidor.use(
    http.get(URL_ROLES, () => HttpResponse.json(lista)),
    http.post(URL_ROLES, async ({ request }) => {
      const cuerpo = await request.json() as Omit<Rol, '_id'>
      peticiones.push({ metodo: 'POST', cuerpo })
      const nuevo = { _id: '664f1c2e9b1e8a3d4c5b6a09', ...cuerpo, sistema: false }
      lista.push(nuevo)
      return HttpResponse.json(nuevo, { status: 201 })
    }),
    http.patch(`${URL_ROLES}/:id`, async ({ request, params }) => {
      const cuerpo = await request.json() as Partial<Rol>
      peticiones.push({ metodo: 'PATCH', cuerpo })
      const i = lista.findIndex((r) => r._id === params.id)
      lista[i] = { ...lista[i], ...cuerpo }
      return HttpResponse.json(lista[i])
    }),
    http.delete(`${URL_ROLES}/:id`, () => {
      peticiones.push({ metodo: 'DELETE' })
      return HttpResponse.json({ detail: 'No se puede eliminar un rol asignado a usuarios' }, { status: 409 })
    }),
  )
  useAuth.setState({ token: 't', usuario })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={qc}><MemoryRouter><AdminRoles /></MemoryRouter></QueryClientProvider>)
  return { peticiones }
}

const tarjeta = (nombre: string) => screen.getByRole('heading', { name: nombre }).closest('li')!

describe('AdminRoles', () => {
  it('lista los roles y bloquea la edición de roles del sistema', async () => {
    entorno()
    await screen.findByRole('heading', { name: 'Técnico' })
    expect(within(tarjeta('Técnico')).queryByRole('button', { name: /Editar/ })).not.toBeInTheDocument()
    expect(within(tarjeta('Técnico')).getByText('Los roles del sistema no se pueden modificar.')).toBeInTheDocument()
    expect(within(tarjeta('Auxiliar')).getByRole('button', { name: /Editar/ })).toBeInTheDocument()
  })

  it('el superadmin limita los permisos del rol admin sin ofrecer los exclusivos', async () => {
    const { peticiones } = entorno(sesionDe('superadmin'), [ADMIN, SISTEMA])
    const u = userEvent.setup()
    await screen.findByRole('heading', { name: 'Administrador' })
    expect(within(tarjeta('Técnico')).queryByRole('button', { name: /Editar/ })).not.toBeInTheDocument()
    expect(within(tarjeta('Administrador')).getByText(/Limita lo que puede hacer el administrador/)).toBeInTheDocument()
    expect(within(tarjeta('Administrador')).queryByRole('button', { name: /Eliminar/ })).not.toBeInTheDocument()

    await u.click(within(tarjeta('Administrador')).getByRole('button', { name: 'Editar permisos' }))
    const form = screen.getByRole('form', { name: 'Permisos del administrador' })
    expect(within(form).queryByLabelText(/^Nombre/)).not.toBeInTheDocument()
    expect(within(form).queryByRole('radiogroup', { name: 'Alcance' })).not.toBeInTheDocument()
    for (const exclusivo of ['Gestionar roles', 'Gestionar configuración', 'Administrar el sistema']) {
      expect(within(form).queryByLabelText(exclusivo)).not.toBeInTheDocument()
    }

    await u.click(within(form).getByRole('button', { name: 'Guardar permisos' }))
    expect(await within(form).findByText('No hay cambios por guardar')).toBeInTheDocument()
    expect(peticiones).toHaveLength(0)

    await u.click(within(form).getByLabelText('Gestionar categorías'))
    await u.click(within(form).getByRole('button', { name: 'Guardar permisos' }))
    await screen.findByText('Permisos del administrador actualizados')
    expect(peticiones[0]).toEqual({
      metodo: 'PATCH',
      cuerpo: { permisos: ADMIN.permisos.filter((p) => p !== 'categorias:gestionar') },
    })
  })

  it('sin sistema:administrar el rol admin sigue siendo de solo lectura', async () => {
    const gestor = { ...sesionDe('admin'), permisos: [...sesionDe('admin').permisos, 'roles:gestionar'] }
    entorno(gestor, [ADMIN])
    await screen.findByRole('heading', { name: 'Administrador' })
    expect(within(tarjeta('Administrador')).queryByRole('button', { name: /Editar/ })).not.toBeInTheDocument()
    expect(within(tarjeta('Administrador')).getByText('Los roles del sistema no se pueden modificar.')).toBeInTheDocument()
  })

  it('crea un rol validado con Zod y envía solo los campos del contrato', async () => {
    const { peticiones } = entorno()
    const u = userEvent.setup()
    await u.click(await screen.findByRole('button', { name: /Nuevo rol/ }))
    await u.click(screen.getByRole('button', { name: 'Crear rol' }))
    expect(await screen.findByText('Solo minúsculas y guion bajo (3 a 30)')).toBeInTheDocument()
    expect(peticiones).toHaveLength(0)

    await u.type(screen.getByLabelText(/Clave/), 'mantenimiento')
    await u.type(screen.getByLabelText(/^Nombre/), 'Mantenimiento')
    await u.click(screen.getByLabelText('Ver incidencias'))
    await u.click(screen.getByRole('button', { name: 'Crear rol' }))
    await screen.findByText('Rol creado correctamente')
    expect(peticiones[0]).toEqual({
      metodo: 'POST',
      cuerpo: { clave: 'mantenimiento', nombre: 'Mantenimiento', descripcion: '', permisos: ['incidencias:ver'], alcance: 'propio' },
    })
    expect(await screen.findByRole('heading', { name: 'Mantenimiento' })).toBeInTheDocument()
  })

  it('edita con PATCH parcial', async () => {
    const { peticiones } = entorno()
    const u = userEvent.setup()
    await screen.findByRole('heading', { name: 'Auxiliar' })
    await u.click(within(tarjeta('Auxiliar')).getByRole('button', { name: /Editar/ }))
    const nombre = screen.getByLabelText(/^Nombre/)
    await u.clear(nombre)
    await u.type(nombre, 'Auxiliar general')
    await u.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await screen.findByText('Cambios guardados correctamente')
    expect(peticiones[0]).toEqual({ metodo: 'PATCH', cuerpo: { nombre: 'Auxiliar general' } })
  })

  it('muestra el 409 al eliminar un rol asignado', async () => {
    entorno()
    const u = userEvent.setup()
    await screen.findByRole('heading', { name: 'Auxiliar' })
    await u.click(within(tarjeta('Auxiliar')).getByRole('button', { name: /Eliminar/ }))
    await u.click(screen.getByRole('button', { name: 'Eliminar rol' }))
    expect(await screen.findByText('No se puede eliminar un rol asignado a usuarios')).toBeInTheDocument()
  })

  it('no ofrece acciones sobre roles con más permisos que el actor', async () => {
    const limitado = { ...sesionDe('admin'), permisos: ['roles:gestionar', 'incidencias:ver'], alcance: 'area' as const }
    const poderoso: Rol = { ...PROPIO, _id: '664f1c2e9b1e8a3d4c5b6a03', clave: 'super', nombre: 'Super', permisos: ['usuarios:gestionar'], alcance: 'global' }
    entorno(limitado, [PROPIO, poderoso])
    await screen.findByRole('heading', { name: 'Super' })
    expect(within(tarjeta('Super')).queryByRole('button', { name: /Editar/ })).not.toBeInTheDocument()
    expect(within(tarjeta('Auxiliar')).getByRole('button', { name: /Editar/ })).toBeInTheDocument()
  })

  it('muestra error con reintento si falla la carga', async () => {
    servidor.use(http.get(URL_ROLES, () => HttpResponse.json({ detail: 'x' }, { status: 500 })))
    useAuth.setState({ token: 't', usuario: sesionDe('superadmin') })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={qc}><MemoryRouter><AdminRoles /></MemoryRouter></QueryClientProvider>)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument())
  })

  it('puedeOtorgar replica la regla del backend', () => {
    const area = { permisos: ['incidencias:ver', 'roles:gestionar'], alcance: 'area' as const }
    expect(puedeOtorgar(area, ['incidencias:ver'], 'propio')).toBe(true)
    expect(puedeOtorgar(area, ['incidencias:ver'], 'area')).toBe(true)
    expect(puedeOtorgar(area, ['incidencias:ver'], 'edificio')).toBe(false)
    expect(puedeOtorgar(area, ['incidencias:ver'], 'global')).toBe(false)
    expect(puedeOtorgar(area, ['usuarios:gestionar'], 'propio')).toBe(false)
    expect(puedeOtorgar({ permisos: ['incidencias:ver'], alcance: 'global' }, ['incidencias:ver'], 'edificio')).toBe(true)
  })
})
