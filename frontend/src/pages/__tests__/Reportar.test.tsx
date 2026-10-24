// @vitest-environment jsdom
import '../../test/setup'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import Reportar from '../Reportar'

const dobles = vi.hoisted(() => ({
  analizarImagen: vi.fn(),
  comprimir: vi.fn(),
}))

vi.mock('../../api/ia', () => ({ analizarImagen: dobles.analizarImagen }))
vi.mock('browser-image-compression', () => ({ default: dobles.comprimir }))

function renderReportar() {
  return render(<MemoryRouter><Reportar /></MemoryRouter>)
}

function seleccionarFoto() {
  const archivo = new File(['foto'], 'foto.jpg', { type: 'image/jpeg' })
  fireEvent.change(screen.getByLabelText('Foto de la incidencia'), { target: { files: [archivo] } })
  return archivo
}

beforeEach(() => {
  dobles.analizarImagen.mockReset()
  dobles.comprimir.mockReset()
  dobles.comprimir.mockImplementation(async (archivo: File) => archivo)
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:foto') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
})

describe('Reportar', () => {
  it('cancela al desmontar', async () => {
    let signal: AbortSignal | undefined
    dobles.analizarImagen.mockImplementation((_datos, opciones) => {
      signal = opciones.signal
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    })
    const errorConsola = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const vista = renderReportar()

    seleccionarFoto()
    await screen.findByText(/Analizando la foto/)
    vista.unmount()
    await Promise.resolve()

    expect(signal?.aborted).toBe(true)
    expect(errorConsola).not.toHaveBeenCalled()
  })

  it('libera la carga tras timeout y mantiene disponible el formulario manual', async () => {
    dobles.analizarImagen.mockRejectedValue(new ApiError(0, 'timeout', 'El servidor tardó demasiado'))
    renderReportar()

    seleccionarFoto()

    expect(await screen.findByText(/Puedes llenar el formulario manualmente/)).toBeInTheDocument()
    expect(screen.queryByText(/Analizando la foto/)).not.toBeInTheDocument()
    const titulo = screen.getByLabelText('Título')
    await userEvent.type(titulo, 'Falla de iluminación')
    expect(titulo).toHaveValue('Falla de iluminación')
    expect(screen.getByRole('button', { name: 'Enviar reporte' })).toBeEnabled()
  })
})
