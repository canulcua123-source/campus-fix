// @vitest-environment jsdom
import '../test/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { BASE } from '../api/client'
import { useAuth } from '../auth/store'
import { sesionDe } from '../test/roles'
import { servidor } from '../test/msw/server'
import { AgregarInformacion } from './AgregarInformacion'
import { ConfirmarSolucion } from './ConfirmarSolucion'
import { dentroDePlazoReapertura } from '../lib/detalle'

const hace = (dias: number) => new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString()

function montar(ui: ReactNode, meId = 'u1') {
  const sesion = sesionDe('reportante')
  useAuth.setState({ token: 't', usuario: sesion })
  servidor.use(http.get(`${BASE}/auth/me`, () => HttpResponse.json({ _id: meId, ...sesion })))
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={cliente}>{ui}</QueryClientProvider>)
}

describe('ConfirmarSolucion', () => {
  it('no se muestra a quien no es el reportante', async () => {
    let pedido = false
    servidor.use(http.get(`${BASE}/auth/me`, () => { pedido = true; return HttpResponse.json({ _id: 'otro', ...sesionDe('reportante') }) }))
    const sesion = sesionDe('reportante')
    useAuth.setState({ token: 't', usuario: sesion })
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={cliente}><ConfirmarSolucion incidenciaId="abc" reportanteId="u1" fechaResolucion={hace(1)} onHecho={vi.fn()} /></QueryClientProvider>)
    await waitFor(() => expect(pedido).toBe(true))
    expect(screen.queryByText('¿Se resolvió tu problema?')).not.toBeInTheDocument()
  })

  it('confirma la solución y deshabilita los botones mientras envía', async () => {
    let cuerpo: unknown
    servidor.use(http.post(`${BASE}/incidencias/abc/confirmacion`, async ({ request }) => {
      cuerpo = await request.json()
      return HttpResponse.json({ ok: true, estado: 'cerrada' })
    }))
    const onHecho = vi.fn()
    montar(<ConfirmarSolucion incidenciaId="abc" reportanteId="u1" fechaResolucion={hace(1)} onHecho={onHecho} />)
    const usuario = userEvent.setup()
    await usuario.click(await screen.findByRole('button', { name: 'Sí, confirmar' }))
    await waitFor(() => expect(onHecho).toHaveBeenCalledWith(expect.stringContaining('cerrada')))
    expect(cuerpo).toEqual({ accion: 'confirmar' })
  })

  it('reabre con motivo opcional desde la hoja inferior', async () => {
    let cuerpo: unknown
    servidor.use(http.post(`${BASE}/incidencias/abc/confirmacion`, async ({ request }) => {
      cuerpo = await request.json()
      return HttpResponse.json({ ok: true, estado: 'abierta' })
    }))
    const onHecho = vi.fn()
    montar(<ConfirmarSolucion incidenciaId="abc" reportanteId="u1" fechaResolucion={hace(2)} onHecho={onHecho} />)
    const usuario = userEvent.setup()
    await usuario.click(await screen.findByRole('button', { name: 'No, reabrir' }))
    const motivo = screen.getByLabelText(/Motivo/)
    await usuario.type(motivo, 'abc')
    await usuario.click(screen.getByRole('button', { name: 'Reabrir reporte' }))
    expect(screen.getByText(/al menos 5 caracteres/)).toBeInTheDocument()
    await usuario.type(motivo, ' sigue fallando')
    await usuario.click(screen.getByRole('button', { name: 'Reabrir reporte' }))
    await waitFor(() => expect(onHecho).toHaveBeenCalled())
    expect(cuerpo).toEqual({ accion: 'reabrir', comentario: 'abc sigue fallando' })
  })

  it('oculta "reabrir" fuera del plazo y muestra el 409 de la API', async () => {
    servidor.use(http.post(`${BASE}/incidencias/abc/confirmacion`, () => HttpResponse.json({ detail: 'La incidencia cambió; intenta de nuevo' }, { status: 409 })))
    montar(<ConfirmarSolucion incidenciaId="abc" reportanteId="u1" fechaResolucion={hace(10)} onHecho={vi.fn()} />)
    const usuario = userEvent.setup()
    await usuario.click(await screen.findByRole('button', { name: 'Sí, confirmar' }))
    expect(screen.queryByRole('button', { name: 'No, reabrir' })).not.toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('La incidencia cambió; intenta de nuevo')
  })

  it('calcula el plazo de 7 días', () => {
    expect(dentroDePlazoReapertura(hace(6.9))).toBe(true)
    expect(dentroDePlazoReapertura(hace(7.1))).toBe(false)
    expect(dentroDePlazoReapertura(undefined)).toBe(false)
  })
})

describe('AgregarInformacion', () => {
  it('valida, envía y avisa con role=status', async () => {
    let cuerpo: unknown
    servidor.use(http.post(`${BASE}/incidencias/abc/comentarios`, async ({ request }) => {
      cuerpo = await request.json()
      return HttpResponse.json({ ok: true, estado: 'en_espera' })
    }))
    montar(<AgregarInformacion incidenciaId="abc" reportanteId="u1" />)
    const usuario = userEvent.setup()
    await usuario.click(await screen.findByRole('button', { name: 'Enviar información' }))
    expect(screen.getByText(/al menos 5 caracteres/)).toBeInTheDocument()
    await usuario.type(screen.getByLabelText(/Información adicional/), 'El proyector es el del lado izquierdo')
    await usuario.click(screen.getByRole('button', { name: 'Enviar información' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Agregamos tu información')
    expect(cuerpo).toEqual({ comentario: 'El proyector es el del lado izquierdo' })
  })

  it('muestra el error de la API con role=alert', async () => {
    servidor.use(http.post(`${BASE}/incidencias/abc/comentarios`, () => HttpResponse.json({ detail: 'Solo se puede comentar una incidencia en espera' }, { status: 409 })))
    montar(<AgregarInformacion incidenciaId="abc" reportanteId="u1" />)
    const usuario = userEvent.setup()
    await usuario.type(await screen.findByLabelText(/Información adicional/), 'Más datos del problema')
    await usuario.click(screen.getByRole('button', { name: 'Enviar información' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Solo se puede comentar una incidencia en espera')
  })

  it('no se muestra a otro usuario', async () => {
    montar(<AgregarInformacion incidenciaId="abc" reportanteId="u1" />, 'otro')
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText('Agregar información')).not.toBeInTheDocument()
  })
})
