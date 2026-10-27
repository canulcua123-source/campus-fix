// @vitest-environment jsdom
import '../../test/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { BASE } from '../../api/client'
import { useAuth } from '../../auth/store'
import type { ConfigIA } from '../../schemas/config'
import { servidor } from '../../test/msw/server'
import { sesionDe } from '../../test/roles'
import AdminConfiguracion from '../AdminConfiguracion'

const URL = `${BASE}/config/ia`
const CONFIG: ConfigIA = {
  habilitada: true,
  limite_diario_usuario: 20,
  limite_diario_global: 500,
  modo_agentico_habilitado: false,
  categorias_agenticas: ['infraestructura'],
  cupo_agentico_usuario_diario: 10,
  cupo_agentico_aula_hora: 3,
}

function entorno({ get = () => HttpResponse.json(CONFIG), patch }: {
  get?: () => Response
  patch?: (cuerpo: Partial<ConfigIA>) => Response
} = {}) {
  const cuerpos: Partial<ConfigIA>[] = []
  servidor.use(
    http.get(URL, get),
    http.patch(URL, async ({ request }) => {
      const cuerpo = await request.json() as Partial<ConfigIA>
      cuerpos.push(cuerpo)
      return patch ? patch(cuerpo) : HttpResponse.json({ ...CONFIG, ...cuerpo })
    }),
  )
  useAuth.setState({ token: 't', usuario: sesionDe('admin') })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={qc}><MemoryRouter><AdminConfiguracion /></MemoryRouter></QueryClientProvider>)
  return { cuerpos }
}

describe('AdminConfiguracion', () => {
  it('carga la configuración y desactiva el modo agéntico si está apagado', async () => {
    entorno()
    expect(screen.getByRole('status', { name: 'Cargando configuración' })).toBeInTheDocument()
    expect(await screen.findByLabelText('Límite diario por usuario')).toHaveValue(20)
    expect(screen.getByRole('switch', { name: 'Asistente de IA' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'Modo agéntico' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('checkbox', { name: 'Infraestructura' })).toBeDisabled()
    expect(screen.getByLabelText('Cupo por aula por hora')).toBeDisabled()
    expect(screen.queryByRole('region', { name: 'Cambios sin guardar' })).not.toBeInTheDocument()
  })

  it('envía solo los campos modificados', async () => {
    const user = userEvent.setup()
    const { cuerpos } = entorno()
    const campo = await screen.findByLabelText('Límite diario por usuario')
    await user.clear(campo)
    await user.type(campo, '50')
    const barra = screen.getByRole('region', { name: 'Cambios sin guardar' })
    await user.click(within(barra).getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Configuración guardada')
    expect(cuerpos).toEqual([{ limite_diario_usuario: 50 }])
    expect(screen.queryByRole('region', { name: 'Cambios sin guardar' })).not.toBeInTheDocument()
  })

  it('descartar regresa a los valores guardados', async () => {
    const user = userEvent.setup()
    entorno()
    const campo = await screen.findByLabelText('Límite diario global')
    await user.clear(campo)
    await user.type(campo, '900')
    await user.click(screen.getByRole('button', { name: 'Descartar' }))
    expect(campo).toHaveValue(500)
  })

  it('valida al salir del campo y marca errores 400 de la API', async () => {
    const user = userEvent.setup()
    const { cuerpos } = entorno({
      patch: () => HttpResponse.json({ error: 'validacion', detalle: [{ loc: ['body', 'limite_diario_global'], msg: 'x', type: 'less_than_equal' }] }, { status: 400 }),
    })
    const usuario = await screen.findByLabelText('Límite diario por usuario')
    await user.clear(usuario)
    await user.type(usuario, '5000')
    await user.tab()
    expect(await screen.findByText('El máximo es 1,000')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(cuerpos).toHaveLength(0)

    await user.clear(usuario)
    await user.type(usuario, '30')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('El valor excede el máximo')).toBeInTheDocument()
    expect(screen.getByLabelText('Límite diario global')).toHaveAttribute('aria-invalid', 'true')
  })

  it('pide confirmación al encender el modo agéntico', async () => {
    const user = userEvent.setup()
    const { cuerpos } = entorno()
    await user.click(await screen.findByRole('switch', { name: 'Modo agéntico' }))
    const academico = screen.getByRole('checkbox', { name: 'Académico' })
    expect(academico).toBeEnabled()
    await user.click(academico)
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    const dialogo = await screen.findByRole('dialog', { name: '¿Encender el modo agéntico?' })
    expect(cuerpos).toHaveLength(0)
    await user.click(within(dialogo).getByRole('button', { name: 'Encender y guardar' }))
    await waitFor(() => expect(cuerpos).toEqual([{ modo_agentico_habilitado: true, categorias_agenticas: ['infraestructura', 'academico'] }]))
  })

  it('muestra un estado amable si la configuración no está disponible (503)', async () => {
    entorno({ get: () => HttpResponse.json({ detail: 'La configuración de IA no está disponible' }, { status: 503 }) })
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('La configuración no está disponible')
    expect(within(alerta).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })
})
