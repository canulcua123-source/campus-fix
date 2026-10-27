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
    estado: screen.getByRole('group', { name: '¿Cómo queda la incidencia?' }),
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

  const { horas, comentario } = abrirFormulario()
  expect(screen.queryByRole('radio', { name: /^Cerrar/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('radio', { name: /^En proceso/ }))
  fireEvent.change(horas, { target: { value: '1.5' } })
  fireEvent.change(comentario, { target: { value: 'Se revisó el equipo y se inició la reparación.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Guardar seguimiento' }))

  await waitFor(() => expect(seguimiento.mutateAsync).toHaveBeenCalledWith({
    estado_nuevo: 'en_proceso',
    horas: 1.5,
    comentario: 'Se revisó el equipo y se inició la reparación.',
  }))
  expect(alGuardar).toHaveBeenCalledWith('en_proceso')
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

it('ofrece el cierre solo a quien tiene permiso de cerrar', () => {
  const { unmount } = render(
    <FormSeguimiento incidenciaId="inc-1" estadoActual="resuelta" puedeCerrar puedeRegistrar />,
  )
  abrirFormulario()
  expect(screen.getByRole('radio', { name: /^Cerrar/ })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: /^Reabrir · En proceso/ })).toBeInTheDocument()
  unmount()

  render(<FormSeguimiento incidenciaId="inc-1" estadoActual="resuelta" puedeCerrar={false} puedeRegistrar />)
  abrirFormulario()
  expect(screen.queryByRole('radio', { name: /^Cerrar/ })).not.toBeInTheDocument()
  expect(screen.getByRole('radio', { name: /^Reabrir · En proceso/ })).toBeInTheDocument()
})

it('no muestra acciones si la incidencia ya no admite transiciones', () => {
  render(<FormSeguimiento incidenciaId="inc-1" estadoActual="retirada" puedeCerrar puedeRegistrar />)

  expect(screen.queryByRole('button', { name: 'Registrar seguimiento' })).not.toBeInTheDocument()
})

it('reinicia el estado inicial cuando cambia el estado actual de la incidencia', async () => {
  seguimiento.mutateAsync.mockResolvedValue({ ok: true, estado: 'en_espera' })
  const props = { incidenciaId: 'inc-1', puedeCerrar: false, puedeRegistrar: true }
  const { rerender } = render(<FormSeguimiento {...props} estadoActual="abierta" />)

  // Tras guardar y refrescar, la incidencia pasó a "en_proceso": el estado inicial anterior ya no es válido.
  rerender(<FormSeguimiento {...props} estadoActual="en_proceso" />)
  const { horas, comentario } = abrirFormulario()
  expect(screen.getByRole('radio', { name: /^En espera/ })).toBeChecked()
  fireEvent.change(horas, { target: { value: '1' } })
  fireEvent.change(comentario, { target: { value: 'Se dejó en espera por falta de refacciones.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Guardar seguimiento' }))

  await waitFor(() => expect(seguimiento.mutateAsync).toHaveBeenCalledWith({
    estado_nuevo: 'en_espera',
    horas: 1,
    comentario: 'Se dejó en espera por falta de refacciones.',
  }))
})
