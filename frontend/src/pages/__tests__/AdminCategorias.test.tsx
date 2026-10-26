// @vitest-environment jsdom
import '../../test/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { BASE } from '../../api/client'
import { useAuth } from '../../auth/store'
import { servidor } from '../../test/msw/server'
import AdminCategorias from '../AdminCategorias'

const SISTEMA = {
  _id: '0123456789abcdef01234567', clave: 'infraestructura', nombre: 'Infraestructura', prefijo: 'INF', area_responsable: 'Servicios Generales',
  version: 1, activa: true, sistema: true, campos: [{ nombre: 'tipo_dano', tipo: 'enum', requerido: true, opciones: ['electrico', 'otro'] }],
}

function montar() {
  const categorias: Record<string, unknown>[] = [SISTEMA]
  const enviados: { metodo: string; url: string; cuerpo: unknown }[] = []
  servidor.use(
    http.get(`${BASE}/categorias`, () => HttpResponse.json(categorias)),
    http.post(`${BASE}/categorias`, async ({ request }) => {
      const cuerpo = await request.json() as Record<string, unknown>
      enviados.push({ metodo: 'POST', url: request.url, cuerpo })
      const creada = { _id: 'fedcba9876543210fedcba98', ...cuerpo, version: 1, activa: true, sistema: false }
      categorias.push(creada)
      return HttpResponse.json(creada, { status: 201 })
    }),
    http.patch(`${BASE}/categorias/:clave`, async ({ request, params }) => {
      const cuerpo = await request.json() as Record<string, unknown>
      enviados.push({ metodo: 'PATCH', url: String(params.clave), cuerpo })
      const i = categorias.findIndex((c) => c.clave === params.clave)
      categorias[i] = { ...categorias[i], ...cuerpo }
      if (cuerpo.activa === false) categorias.splice(i, 1)
      return HttpResponse.json({ ...SISTEMA, ...cuerpo })
    }),
  )
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={cliente}><MemoryRouter><AdminCategorias /></MemoryRouter></QueryClientProvider>)
  return enviados
}

describe('AdminCategorias (T-061)', () => {
  beforeEach(() => {
    useAuth.setState({
      token: 'token-sintetico-t061',
      usuario: { nombre: 'Admin', rol: 'admin', alcance: 'global', permisos: ['categorias:gestionar'] },
    })
  })

  it('crea categoria con 2 campos', async () => {
    const u = userEvent.setup()
    const enviados = montar()
    await u.click(await screen.findByRole('button', { name: 'Nueva categoría' }))
    await u.type(screen.getByRole('textbox', { name: 'Nombre' }), 'Laboratorios')
    expect(screen.getByRole('textbox', { name: /^Clave/ })).toHaveValue('laboratorios')
    await u.type(screen.getByRole('textbox', { name: /Prefijo/ }), 'lab')
    await u.type(screen.getByRole('textbox', { name: /Área responsable/ }), 'Coordinación de laboratorios')

    const campo1 = screen.getByRole('listitem', { name: 'Campo 1' })
    await u.type(within(campo1).getByRole('textbox', { name: /^Etiqueta/ }), 'Número de serie')
    expect(within(campo1).getByRole('textbox', { name: /Nombre interno/ })).toHaveValue('numero_de_serie')

    await u.click(screen.getByRole('button', { name: 'Agregar campo' }))
    const campo2 = screen.getByRole('listitem', { name: 'Campo 2' })
    await u.type(within(campo2).getByRole('textbox', { name: /^Etiqueta/ }), 'Turno')
    await u.selectOptions(within(campo2).getByRole('combobox', { name: 'Tipo' }), 'lista')
    await u.type(within(campo2).getByRole('textbox', { name: /Opciones/ }), 'Matutino{Enter}Vespertino')
    await u.click(within(campo2).getByRole('checkbox', { name: 'Obligatorio' }))

    // Vista previa en vivo con el formulario dinámico.
    const previa = screen.getByRole('region', { name: 'Vista previa del formulario' })
    expect(within(previa).getByRole('textbox', { name: /Número de serie/ })).toBeInTheDocument()
    expect(within(previa).getByRole('option', { name: 'Vespertino' })).toBeInTheDocument()
    await u.click(within(previa).getByRole('button', { name: 'Probar validación' }))
    expect(within(previa).getByText('Este campo es obligatorio')).toBeInTheDocument()

    await u.click(screen.getByRole('button', { name: 'Crear categoría' }))
    expect(await screen.findByText(/Categoría creada/)).toBeInTheDocument()
    expect(enviados).toEqual([{
      metodo: 'POST', url: `${BASE}/categorias`, cuerpo: {
        clave: 'laboratorios', nombre: 'Laboratorios', prefijo: 'LAB', area_responsable: 'Coordinación de laboratorios',
        campos: [
          { nombre: 'numero_de_serie', etiqueta: 'Número de serie', tipo: 'texto', requerido: true },
          { nombre: 'turno', etiqueta: 'Turno', tipo: 'lista', requerido: false, opciones: ['Matutino', 'Vespertino'] },
        ],
      },
    }])
    expect(await screen.findByText('Laboratorios')).toBeInTheDocument()
  })

  it('valida antes de enviar y no manda nada si falta información', async () => {
    const u = userEvent.setup()
    const enviados = montar()
    await u.click(await screen.findByRole('button', { name: 'Nueva categoría' }))
    await u.click(screen.getByRole('button', { name: 'Crear categoría' }))
    expect(screen.getByText('El prefijo son 3 letras mayúsculas (p. ej. LAB)')).toBeInTheDocument()
    expect(screen.getByText('Escribe la etiqueta')).toBeInTheDocument()
    expect(enviados).toHaveLength(0)
  })

  it('marca las categorías del sistema como no eliminables', async () => {
    const u = userEvent.setup()
    montar()
    expect(await screen.findByText(/no se puede eliminar/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Desactivar Infraestructura' })).not.toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Editar Infraestructura' }))
    expect(screen.getByRole('textbox', { name: /Prefijo/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Agregar campo' })).not.toBeInTheDocument()
  })

  it('edita el nombre de una categoría del sistema con PATCH parcial', async () => {
    const u = userEvent.setup()
    const enviados = montar()
    await u.click(await screen.findByRole('button', { name: 'Editar Infraestructura' }))
    const nombre = screen.getByRole('textbox', { name: 'Nombre' })
    await u.clear(nombre)
    await u.type(nombre, 'Infraestructura física')
    await u.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(enviados).toEqual([{ metodo: 'PATCH', url: 'infraestructura', cuerpo: { nombre: 'Infraestructura física' } }]))
  })
})
