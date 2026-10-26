// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApiError } from '../api/client'
import { FormSeguimiento } from './FormSeguimiento'

const seguimiento = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
}))

vi.mock('../api/hooks/incidencias', () => ({
  useSeguimiento: () => seguimiento,
}))

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})

afterEach(() => {
  cleanup()
  seguimiento.mutateAsync.mockReset()
  seguimiento.isPending = false
})

function abrirFormulario() {
  fireEvent.click(screen.getByRole('button', { name: 'Registrar seguimiento' }))
  return {
    estado: screen.getByLabelText(/Nuevo estado/),
    horas: screen.getByLabelText(/Horas invertidas/),
    comentario: screen.getByLabelText(/Comentario/),
  }
}

it('no muestra acciones de seguimiento a quien no puede registrarlo', () => {
  render(
    <FormSeguimiento
      incidenciaId="inc-1"
      estadoActual="abierta"
      puedeCerrar={false}
      puedeRegistrar={false}
    />,
  )

  expect(screen.queryByRole('button', { name: 'Registrar seguimiento' })).not.toBeInTheDocument()
})

it('registra una transición permitida con horas y comentario', async () => {
  seguimiento.mutateAsync.mockResolvedValue({ ok: true, estado: 'en_proceso' })
  const alGuardar = vi.fn()
  render(
    <FormSeguimiento
      incidenciaId="inc-1"
      estadoActual="abierta"
      puedeCerrar={false}
      puedeRegistrar
      onSeguimientoGuardado={alGuardar}
    />,
  )

  const { estado, horas, comentario } = abrirFormulario()
  expect(screen.queryByRole('option', { name: 'Cerrada' })).not.toBeInTheDocument()
  fireEvent.change(estado, { target: { value: 'en_proceso' } })
  fireEvent.change(horas, { target: { value: '1.5' } })
  fireEvent.change(comentario, { target: { value: 'Se revisó el equipo y se inició la reparación.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Guardar seguimiento' }))

  await waitFor(() => expect(seguimiento.mutateAsync).toHaveBeenCalledWith({
    estado_nuevo: 'en_proceso',
    horas: 1.5,
    comentario: 'Se revisó el equipo y se inició la reparación.',
  }))
  expect(alGuardar).toHaveBeenCalledOnce()
})

it('informa el conflicto cuando el estado cambió durante el registro', async () => {
  seguimiento.mutateAsync.mockRejectedValue(new ApiError(409, 'conflicto', 'Conflicto'))
  render(
    <FormSeguimiento
      incidenciaId="inc-1"
      estadoActual="abierta"
      puedeCerrar={false}
      puedeRegistrar
    />,
  )

  const { horas, comentario } = abrirFormulario()
  fireEvent.change(horas, { target: { value: '1' } })
  fireEvent.change(comentario, { target: { value: 'Se documentó la revisión realizada.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Guardar seguimiento' }))

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'El estado cambió mientras registrabas el seguimiento. Actualiza la incidencia e inténtalo de nuevo.',
  )
})
