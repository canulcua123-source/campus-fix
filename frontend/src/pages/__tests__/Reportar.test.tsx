// @vitest-environment jsdom
import '../../test/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, BASE, camposDeDetalle } from '../../api/client'
import { servidor } from '../../test/msw/server'
import { ErrorImagen } from '../../lib/imagen'
import Reportar from '../Reportar'

const dobles = vi.hoisted(() => ({
  analizarImagen: vi.fn(),
  procesarFoto: vi.fn(),
}))

vi.mock('../../api/ia', () => ({ analizarImagen: dobles.analizarImagen }))
vi.mock('../../lib/fotoEnSegundoPlano', () => ({ procesarFotoEnSegundoPlano: dobles.procesarFoto }))

function renderReportar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={cliente}><MemoryRouter><Reportar /></MemoryRouter></QueryClientProvider>)
}

/** Prioridad es un control segmentado: el valor es el botón con aria-pressed. */
const grupoPrioridad = () => screen.getByRole('group', { name: 'Prioridad' })
const prioridadActual = () => within(grupoPrioridad()).getByRole('button', { pressed: true }).textContent
const elegirPrioridad = (texto: string, user: Pick<typeof userEvent, 'click'> = userEvent) => user.click(within(grupoPrioridad()).getByRole('button', { name: texto }))

function seleccionarFoto() {
  const archivo = new File(['foto'], 'foto.jpg', { type: 'image/jpeg' })
  fireEvent.change(screen.getByLabelText('Foto de la incidencia'), { target: { files: [archivo] } })
  return archivo
}

beforeEach(() => {
  dobles.analizarImagen.mockReset()
  dobles.procesarFoto.mockReset()
  dobles.procesarFoto.mockImplementation(async (archivo: File) => ({ evidencia: archivo, ia: archivo, miniatura: archivo, calidad: { nitidez: 500, brillo: 120, borrosa: false, oscura: false, sobreexpuesta: false }, ancho: 1, alto: 1 }))
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:foto') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
})

describe('Reportar', () => {
  it('analiza el derivado ia (1280 px) y no el archivo original (T-047)', async () => {
    const ia = new File(['ia'], 'ia.jpg', { type: 'image/jpeg' })
    dobles.procesarFoto.mockImplementation(async (archivo: File) => ({ evidencia: archivo, ia, miniatura: archivo, calidad: { nitidez: 500, brillo: 120, borrosa: false, oscura: false, sobreexpuesta: false }, ancho: 1, alto: 1 }))
    dobles.analizarImagen.mockReturnValue(new Promise(() => undefined))
    renderReportar()

    expect(screen.getByLabelText('Foto de la incidencia')).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp')
    seleccionarFoto()

    await waitFor(() => expect(dobles.analizarImagen).toHaveBeenCalled())
    expect(dobles.analizarImagen.mock.calls[0][0].imagen).toBe(ia)
  })

  it('si la foto no se puede procesar avisa y deja el formulario manual', async () => {
    dobles.procesarFoto.mockRejectedValue(new ErrorImagen('La foto pesa más de 30 MB. Toma otra foto o elige una más ligera.'))
    renderReportar()

    seleccionarFoto()

    expect(await screen.findByText(/pesa más de 30 MB/)).toBeInTheDocument()
    expect(dobles.analizarImagen).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Enviar reporte' })).toBeEnabled()
  })

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

  it('no sobrescribe lo que el usuario ya escribió al llegar la sugerencia', async () => {
    let resolver: (valor: unknown) => void = () => undefined
    dobles.analizarImagen.mockImplementation(() => new Promise((resolve) => { resolver = resolve }))
    renderReportar()

    seleccionarFoto()
    await screen.findByText(/Analizando la foto/)
    const titulo = screen.getByLabelText('Título')
    await userEvent.type(titulo, 'Escrito por mí')
    resolver({
      accion: 'formulario', motivos: ['Confirma la ubicación.'], analisis_id: '901bba9a-9e5f-4cb9-8fe4-4c22710ad5a4', accion_asistida: 'autollenar', mensaje: 'Revisa los datos', cache: false,
      analisis: {
        es_incidencia_valida: true, categoria: 'infraestructura', titulo: 'Luminaria fundida',
        descripcion: 'Se observa una luminaria apagada', prioridad_sugerida: 'alta', tags: ['luminaria'],
        campos_detectados: [], confianza: 0.9, advertencias: [],
      },
    })

    await waitFor(() => expect(screen.getByLabelText('Descripción')).toHaveValue('Se observa una luminaria apagada'))
    expect(titulo).toHaveValue('Escrito por mí')
  })

  it('no autollena riesgo alto de infraestructura: lo deja en medio para que la persona lo confirme', async () => {
    dobles.analizarImagen.mockResolvedValue({
      accion: 'formulario', motivos: [], analisis_id: '901bba9a-9e5f-4cb9-8fe4-4c22710ad5a4',
      accion_asistida: 'sugerir', mensaje: 'Revisa los datos', cache: false,
      analisis: {
        es_incidencia_valida: true, categoria: 'infraestructura', titulo: 'Cable expuesto',
        descripcion: 'Hay un cable eléctrico expuesto en el pasillo', prioridad_sugerida: 'critica', tags: ['electrico'],
        campos_detectados: [], confianza: 0.7, advertencias: [],
        detalle_infra: { tipo_dano: 'electrico', riesgo_seguridad: 'alto' },
      },
    })
    renderReportar()

    seleccionarFoto()

    await waitFor(() => expect(screen.getByLabelText('Riesgo de seguridad')).toHaveValue('medio'))
    expect(prioridadActual()).toBe('Alta')
  })
})

const ID_ANALISIS = '901bba9a-9e5f-4cb9-8fe4-4c22710ad5a4'

function respuestaIA(prioridad: 'baja' | 'media' | 'alta' | 'critica' = 'alta') {
  return {
    accion: 'formulario', motivos: [], analisis_id: ID_ANALISIS, accion_asistida: 'autollenar', mensaje: 'Revisa los datos', cache: false,
    analisis: {
      es_incidencia_valida: true, categoria: 'computo_redes', titulo: 'Proyector no enciende',
      descripcion: 'El proyector del aula no enciende desde ayer', prioridad_sugerida: prioridad, tags: ['proyector'],
      campos_detectados: [], confianza: 0.9, advertencias: [],
    },
  }
}

describe('Reportar: control de calidad de la foto (T-051)', () => {
  function fotoBorrosa() {
    dobles.procesarFoto.mockImplementation(async (archivo: File) => ({
      evidencia: archivo, ia: archivo, miniatura: archivo, ancho: 1, alto: 1,
      calidad: { nitidez: 10, brillo: 30, borrosa: true, oscura: true, sobreexpuesta: false },
    }))
  }

  it('avisa sin bloquear y solo analiza al elegir "Usar de todos modos", con calidad_cliente', async () => {
    fotoBorrosa()
    dobles.analizarImagen.mockResolvedValue(respuestaIA())
    renderReportar()

    seleccionarFoto()

    expect(await screen.findByText('La foto parece borrosa y está muy oscura.')).toBeInTheDocument()
    expect(dobles.analizarImagen).not.toHaveBeenCalled()
    const titulo = screen.getByLabelText('Título')
    await userEvent.type(titulo, 'Escrito durante el aviso')
    expect(titulo).toHaveValue('Escrito durante el aviso')

    await userEvent.click(screen.getByRole('button', { name: 'Usar de todos modos' }))

    await waitFor(() => expect(dobles.analizarImagen).toHaveBeenCalledOnce())
    expect(dobles.analizarImagen.mock.calls[0][0]).toMatchObject({ calidad_cliente: ['borrosa', 'oscura'] })
    expect(screen.queryByText('La foto parece borrosa y está muy oscura.')).not.toBeInTheDocument()
  })

  it('"Repetir" vuelve a abrir la cámara sin analizar la foto descartada', async () => {
    fotoBorrosa()
    renderReportar()
    seleccionarFoto()
    await screen.findByText(/La foto parece borrosa/)
    const entrada = screen.getByLabelText('Foto de la incidencia')
    const click = vi.spyOn(entrada, 'click').mockImplementation(() => undefined)

    await userEvent.click(screen.getByRole('button', { name: 'Repetir' }))

    expect(click).toHaveBeenCalledOnce()
    expect(dobles.analizarImagen).not.toHaveBeenCalled()
    expect(screen.queryByText(/La foto parece borrosa/)).not.toBeInTheDocument()
  })

  it('una foto que pasa el control se analiza sin calidad_cliente', async () => {
    dobles.analizarImagen.mockResolvedValue(respuestaIA())
    renderReportar()
    seleccionarFoto()

    await waitFor(() => expect(dobles.analizarImagen).toHaveBeenCalledOnce())
    expect(dobles.analizarImagen.mock.calls[0][0].calidad_cliente).toBeUndefined()
  })
})

describe('Reportar con IA no bloqueante (T-024)', () => {
  it('el formulario es editable mientras la IA analiza y se puede continuar sin IA', async () => {
    let signal: AbortSignal | undefined
    dobles.analizarImagen.mockImplementation((_datos, opciones) => {
      signal = opciones.signal
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    })
    renderReportar()

    seleccionarFoto()
    await screen.findByText(/Analizando la foto/)
    const titulo = screen.getByLabelText('Título')
    expect(titulo).toBeEnabled()
    await userEvent.type(titulo, 'Escrito mientras analiza')

    await userEvent.click(screen.getByRole('button', { name: 'Continuar sin IA' }))

    expect(signal?.aborted).toBe(true)
    expect(screen.queryByText(/Analizando la foto/)).not.toBeInTheDocument()
    expect(await screen.findByText(/Continúas sin IA/)).toBeInTheDocument()
    expect(titulo).toHaveValue('Escrito mientras analiza')
    expect(screen.getByRole('button', { name: 'Enviar reporte' })).toBeEnabled()
  })

  it('una prioridad crítica sugerida pide confirmación y mientras tanto queda en alta', async () => {
    dobles.analizarImagen.mockResolvedValue(respuestaIA('critica'))
    renderReportar()

    seleccionarFoto()

    expect(await screen.findByText('La IA sugiere prioridad crítica')).toBeInTheDocument()
    expect(prioridadActual()).toBe('Alta')

    await userEvent.click(screen.getByRole('button', { name: 'Sí, es crítica' }))

    expect(prioridadActual()).toBe('Crítica')
    expect(screen.queryByText('La IA sugiere prioridad crítica')).not.toBeInTheDocument()
  })

  it('puede rechazar la prioridad crítica o descartarla al editar la prioridad', async () => {
    dobles.analizarImagen.mockResolvedValue(respuestaIA('critica'))
    renderReportar()

    seleccionarFoto()
    await screen.findByText('La IA sugiere prioridad crítica')
    await userEvent.click(screen.getByRole('button', { name: 'No, mantener alta' }))
    expect(screen.queryByText('La IA sugiere prioridad crítica')).not.toBeInTheDocument()
    expect(prioridadActual()).toBe('Alta')
  })

  it('editar la prioridad a mano descarta la confirmación pendiente', async () => {
    dobles.analizarImagen.mockResolvedValue(respuestaIA('critica'))
    renderReportar()

    seleccionarFoto()
    await screen.findByText('La IA sugiere prioridad crítica')
    await elegirPrioridad('Media')

    expect(screen.queryByText('La IA sugiere prioridad crítica')).not.toBeInTheDocument()
    expect(prioridadActual()).toBe('Media')
  })

  it('envía el contexto opcional del usuario al análisis', async () => {
    dobles.analizarImagen.mockResolvedValue(respuestaIA())
    renderReportar()

    await userEvent.type(screen.getByLabelText('Contexto para la IA (opcional)'), 'El proyector se apaga solo')
    seleccionarFoto()

    await waitFor(() => expect(dobles.analizarImagen).toHaveBeenCalled())
    expect(dobles.analizarImagen.mock.calls[0][0]).toMatchObject({ contexto: 'El proyector se apaga solo' })
  })

  it('marca los campos sugeridos por la IA y retira la marca al editarlos', async () => {
    dobles.analizarImagen.mockResolvedValue(respuestaIA())
    renderReportar()

    seleccionarFoto()
    await waitFor(() => expect(screen.getByLabelText('Título')).toHaveValue('Proyector no enciende'))
    const antes = screen.getAllByText('Sugerido por IA').length
    expect(antes).toBeGreaterThan(0)

    await userEvent.type(screen.getByLabelText('Título'), ' corregido')

    expect(screen.getAllByText('Sugerido por IA')).toHaveLength(antes - 1)
  })
})

describe('Reportar completo (T-049)', () => {
  async function abrirFormularioManual() {
    renderReportar()
    await userEvent.click(screen.getByRole('button', { name: 'Llenar sin foto' }))
  }

  async function llenarMinimo(user = userEvent.setup()) {
    await user.type(screen.getByLabelText('Título'), 'Switch sin enlace')
    await user.type(screen.getByLabelText('Descripción'), 'El switch del laboratorio no tiene enlace')
    await user.type(screen.getByLabelText('Edificio'), 'Edificio A')
    await user.type(screen.getByLabelText('Aula'), 'A-301')
    await user.type(screen.getByLabelText('IP'), '10.0.0.5')
    return user
  }

  it('muestra campos por categoria y limpia el detalle anterior al cambiarla', async () => {
    await abrirFormularioManual()
    expect(screen.getByLabelText('IP')).toBeInTheDocument()
    expect(screen.getByLabelText('VLAN')).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Categoría'), 'academico')
    expect(screen.queryByLabelText('IP')).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Código de curso'), 'MAT-101')

    await userEvent.selectOptions(screen.getByLabelText('Categoría'), 'infraestructura')
    expect(screen.getByLabelText('Tipo de daño')).toBeInTheDocument()
    expect(screen.getByLabelText('Riesgo de seguridad')).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Categoría'), 'academico')
    expect(screen.getByLabelText('Código de curso')).toHaveValue('')
  })

  it('etiquetas legibles', async () => {
    await abrirFormularioManual()
    expect(within(grupoPrioridad()).getByRole('button', { name: 'Crítica' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Cómputo y redes' })).toHaveValue('computo_redes')
    expect(screen.queryByRole('option', { name: 'critica' })).not.toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Categoría'), 'infraestructura')
    expect(screen.getByRole('option', { name: 'Filtración' })).toHaveValue('filtracion')
    expect(screen.getByRole('option', { name: 'Climatización' })).toHaveValue('climatizacion')
  })

  it('error al salir del campo', async () => {
    await abrirFormularioManual()
    const titulo = screen.getByLabelText('Título')

    await userEvent.type(titulo, 'abc')
    expect(screen.queryByText('Mínimo 5 caracteres')).not.toBeInTheDocument()

    await userEvent.tab()
    expect(await screen.findByText('Mínimo 5 caracteres')).toBeInTheDocument()
    expect(titulo).toHaveAttribute('aria-invalid', 'true')
    expect(titulo).toHaveAccessibleDescription(/Mínimo 5 caracteres/)

    await userEvent.type(titulo, 'de prueba')
    await waitFor(() => expect(screen.queryByText('Mínimo 5 caracteres')).not.toBeInTheDocument())
  })

  it('envia y muestra folio', async () => {
    let cuerpo: unknown
    servidor.use(http.post(`${BASE}/incidencias`, async ({ request }) => {
      cuerpo = await request.json()
      return HttpResponse.json({ _id: 'inc1', codigo: 'INC-2026-1026-RED-0001', estado: 'abierta' }, { status: 201 })
    }))
    await abrirFormularioManual()
    const user = await llenarMinimo()
    await elegirPrioridad('Alta', user)

    await user.click(screen.getByRole('button', { name: 'Enviar reporte' }))

    expect(await screen.findByText('INC-2026-1026-RED-0001')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver mi reporte' })).toHaveAttribute('href', '/incidencias/inc1')
    expect(cuerpo).toMatchObject({
      titulo: 'Switch sin enlace', prioridad: 'alta',
      ubicacion: { edificio: 'Edificio A', aula: 'A-301' },
      detalle_especifico: { categoria: 'computo_redes', ip: '10.0.0.5', vlan: 1 },
    })
  })

  it('muestra error 400 por campo', async () => {
    const detalle = [
      { loc: ['body', 'detalle_especifico', 'computo_redes', 'vlan'], msg: 'Input should be less than or equal to 4094', type: 'less_than_equal', ctx: { le: 4094 } },
      { loc: ['body'], msg: 'Ubicación fuera del campus', type: 'value_error' },
    ]
    servidor.use(http.post(`${BASE}/incidencias`, () => HttpResponse.json({ error: 'validacion', detalle }, { status: 400 })))
    const esperado = camposDeDetalle(detalle)
    await abrirFormularioManual()
    const user = await llenarMinimo()

    await user.click(screen.getByRole('button', { name: 'Enviar reporte' }))

    const vlan = screen.getByLabelText('VLAN')
    await waitFor(() => expect(vlan).toHaveAttribute('aria-invalid', 'true'))
    expect(vlan).toHaveAccessibleDescription(new RegExp(esperado['detalle_especifico.vlan']))
    expect(screen.getByRole('alert')).toHaveTextContent(esperado._general)
    expect(screen.queryByText('INC-2026-1026-RED-0001')).not.toBeInTheDocument()
  })
})
