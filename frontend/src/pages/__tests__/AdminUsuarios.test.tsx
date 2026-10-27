// @vitest-environment jsdom
import '../../test/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { BASE } from '../../api/client'
import { errorFortalezaPassword, tecnicosActivos } from '../../api/usuarios'
import { useAuth } from '../../auth/store'
import type { Rol, UsuarioApi } from '../../schemas/usuario'
import { servidor } from '../../test/msw/server'
import AdminUsuarios from '../AdminUsuarios'

const ADMIN_ID = '664f1c2e9b1e8a3d4c5b6a71'
const ANA_ID = '664f1c2e9b1e8a3d4c5b6a72'
const BASE_USUARIOS = `${BASE}/usuarios`
const BASE_ROLES = `${BASE}/roles`
const ROLES: Rol[] = [
    { _id: '664f1c2e9b1e8a3d4c5b6a73', clave: 'admin', nombre: 'Administrador', alcance: 'global', permisos: ['usuarios:gestionar'] },
    { _id: '664f1c2e9b1e8a3d4c5b6a74', clave: 'tecnico', nombre: 'Técnico', alcance: 'area', permisos: ['seguimiento:registrar'] },
]
const ANA: UsuarioApi = {
    _id: ANA_ID, nombre: 'Ana López', correo: 'ana@utm.edu.mx', rol: 'tecnico', activo: true, areas: ['computo_redes'],
}
const ADMIN: UsuarioApi = { _id: ADMIN_ID, nombre: 'Administrador', correo: 'admin@utm.edu.mx', rol: 'admin', activo: true }

function entorno(usuariosIniciales: UsuarioApi[] = [ADMIN, ANA]) {
    const usuarios = [...usuariosIniciales]
    servidor.use(
        http.get(BASE_USUARIOS, () => HttpResponse.json(usuarios)),
        http.get(BASE_ROLES, () => HttpResponse.json(ROLES)),
    )
    useAuth.setState({
        token: 'token-de-prueba',
        usuario: { nombre: 'Administrador', rol: 'admin', permisos: ['usuarios:gestionar'], alcance: 'global' },
    })
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    return {
        usuarios,
        ...render(
            <QueryClientProvider client={cliente}>
                <MemoryRouter><AdminUsuarios /></MemoryRouter>
            </QueryClientProvider>,
        ),
    }
}

describe('AdminUsuarios (T-057)', () => {
    it('crea usuario con rol y área y valida la contraseña inicial', async () => {
        const creado = vi.fn()
        servidor.use(http.post(BASE_USUARIOS, async ({ request }) => {
            const datos = await request.json() as Record<string, unknown>
            creado(datos)
            return HttpResponse.json({ _id: '664f1c2e9b1e8a3d4c5b6a75', ...datos, password: undefined, activo: true }, { status: 201 })
        }))
        entorno()
        const persona = userEvent.setup()
        await persona.click(await screen.findByRole('button', { name: 'Nuevo usuario' }))
        fireEvent.change(screen.getByRole('textbox', { name: /Nombre completo/i }), { target: { value: 'María Pérez' } })
        fireEvent.change(screen.getByRole('textbox', { name: /Correo institucional/i }), { target: { value: 'maria@utm.edu.mx' } })
        fireEvent.change(screen.getByRole('combobox', { name: /^Rol/i }), { target: { value: 'tecnico' } })
        fireEvent.click(screen.getByRole('checkbox', { name: 'Cómputo y redes' }))
        fireEvent.change(screen.getByLabelText(/Contraseña inicial/i), { target: { value: 'ClaveSegura12!' } })
        fireEvent.change(screen.getByLabelText(/Confirmar contraseña/i), { target: { value: 'ClaveSegura12!' } })
        await persona.click(screen.getByRole('button', { name: 'Crear usuario' }))
        await waitFor(() => expect(creado).toHaveBeenCalledOnce())
        expect(creado.mock.calls[0][0]).toMatchObject({ nombre: 'María Pérez', correo: 'maria@utm.edu.mx', rol: 'tecnico', areas: ['computo_redes'] })
        expect(await screen.findByText('Usuario creado correctamente')).toBeInTheDocument()
        expect(screen.queryByLabelText(/Contraseña inicial/i)).not.toBeInTheDocument()
    })

    it('409 correo duplicado muestra error en el campo', async () => {
        servidor.use(http.post(BASE_USUARIOS, () => HttpResponse.json({ error: 'duplicado', detalle: 'Ya existe un usuario con ese correo' }, { status: 409 })))
        entorno()
        const persona = userEvent.setup()
        await persona.click(await screen.findByRole('button', { name: 'Nuevo usuario' }))
        fireEvent.change(screen.getByRole('textbox', { name: /Nombre completo/i }), { target: { value: 'María Pérez' } })
        fireEvent.change(screen.getByRole('textbox', { name: /Correo institucional/i }), { target: { value: 'ana@utm.edu.mx' } })
        fireEvent.change(screen.getByRole('combobox', { name: /^Rol/i }), { target: { value: 'tecnico' } })
        fireEvent.click(screen.getByRole('checkbox', { name: 'Cómputo y redes' }))
        fireEvent.change(screen.getByLabelText(/Contraseña inicial/i), { target: { value: 'ClaveSegura12!' } })
        fireEvent.change(screen.getByLabelText(/Confirmar contraseña/i), { target: { value: 'ClaveSegura12!' } })
        await persona.click(screen.getByRole('button', { name: 'Crear usuario' }))
        expect(await screen.findByText('Ya existe un usuario con ese correo')).toBeInTheDocument()
        expect(screen.getByRole('textbox', { name: /Correo institucional/i })).toHaveAttribute('aria-invalid', 'true')
    })

    it('desactiva con confirmación y después permite reactivar', async () => {
        const cambios: unknown[] = []
        const contexto = entorno()
        servidor.use(http.patch(`${BASE_USUARIOS}/${ANA_ID}`, async ({ request }) => {
            const datos = await request.json() as { activo: boolean }
            cambios.push(datos)
            const actual = contexto.usuarios.find((u) => u._id === ANA_ID)!
            actual.activo = datos.activo
            return HttpResponse.json(actual)
        }))
        const persona = userEvent.setup()
        const fila = (await screen.findByText('Ana López')).closest('tr')!
        await persona.click(within(fila).getByRole('button', { name: 'Desactivar' }))
        expect(screen.getByRole('dialog', { name: '¿Desactivar usuario?' })).toBeInTheDocument()
        expect(cambios).toHaveLength(0)
        await persona.click(screen.getByRole('button', { name: 'Confirmar desactivación' }))
        await waitFor(() => expect(cambios).toEqual([{ activo: false }]))
        expect(await screen.findByText('Usuario desactivado correctamente')).toBeInTheDocument()
        await waitFor(() => expect(within(fila).getByRole('button', { name: 'Reactivar' })).toBeInTheDocument())
        await persona.click(within(fila).getByRole('button', { name: 'Reactivar' }))
        await persona.click(screen.getByRole('button', { name: 'Confirmar reactivación' }))
        await waitFor(() => expect(cambios).toEqual([{ activo: false }, { activo: true }]))
    })

    it('permite editar sin mostrar la contraseña ni enviar campos no modificados', async () => {
        let cuerpo: Record<string, unknown> = {}
        entorno()
        servidor.use(http.patch(`${BASE_USUARIOS}/${ANA_ID}`, async ({ request }) => {
            cuerpo = await request.json() as Record<string, unknown>
            return HttpResponse.json({ ...ANA, ...cuerpo })
        }))
        const persona = userEvent.setup()
        const fila = (await screen.findByText('Ana López')).closest('tr')!
        await persona.click(within(fila).getByRole('button', { name: 'Editar' }))
        expect(screen.queryByLabelText(/Contraseña inicial/i)).not.toBeInTheDocument()
        const nombre = screen.getByRole('textbox', { name: 'Nombre completo' })
        await persona.clear(nombre)
        await persona.type(nombre, 'Ana Rodríguez')
        await persona.click(screen.getByRole('button', { name: 'Guardar cambios' }))
        await waitFor(() => expect(cuerpo).toEqual({ nombre: 'Ana Rodríguez' }))
    })

    it('omite desactivados de selectores de técnicos', () => {
        expect(tecnicosActivos([ANA, { ...ANA, _id: 'otro', activo: false }, ADMIN], ROLES).map((u) => u._id)).toEqual([ANA_ID])
    })

    it('requiere contraseña robusta al crear', () => {
        expect(errorFortalezaPassword('corta')).not.toBeNull()
        expect(errorFortalezaPassword('ClaveSegura12!')).toBeNull()
    })

    it('no muestra administración de usuarios sin el permiso correspondiente', async () => {
        entorno()
        act(() => useAuth.setState({ usuario: { nombre: 'Lector', rol: 'reportante', permisos: [], alcance: 'propio' } }))
        expect(await screen.findByText('Acceso restringido')).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Nuevo usuario' })).not.toBeInTheDocument()
    })
})
