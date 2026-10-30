// @vitest-environment jsdom
import '../../test/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, BASE } from '../../api/client'
import { servidor } from '../../test/msw/server'
import Reportar from '../Reportar'

const dobles = vi.hoisted(() => ({
  analizarImagen: vi.fn(),
  registrarEventoIA: vi.fn(),
  confirmarAdhesion: vi.fn(),
  procesarFoto: vi.fn(),
}))

vi.mock('../../api/ia', () => ({
  analizarImagen: dobles.analizarImagen,
  registrarEventoIA: dobles.registrarEventoIA,
  confirmarAdhesion: dobles.confirmarAdhesion,
}))
vi.mock('../../lib/fotoEnSegundoPlano', () => ({ procesarFotoEnSegundoPlano: dobles.procesarFoto }))

const AULA = 'AbCdEfGhIjKlMnOpQrStUv'
const ID_ANALISIS = '901bba9a-9e5f-4cb9-8fe4-4c22710ad5a4'
const COINCIDENCIA = 'c'.repeat(43)
const FOLIO = 'INC-2026-1030-INF-0007'

function respuestaDuplicado(adhesiones = 2) {
  return {
    accion: 'duplicado', motivos: [], analisis_id: ID_ANALISIS, accion_asistida: 'autollenar',
    mensaje: 'Encontramos un posible reporte duplicado; confirma cómo deseas continuar.', cache: false,
    analisis: {
      es_incidencia_valida: true, categoria: 'infraestructura', titulo: 'Luminaria fundida',
      descripcion: 'La luminaria del aula está apagada', prioridad_sugerida: 'baja', tags: ['luminaria'],
      campos_detectados: [], confianza: 0.9, advertencias: [],
      detalle_infra: { tipo_dano: 'luminaria', riesgo_seguridad: 'bajo' },
    },
    duplicado: {
      accion: 'duplicado', coincidencia_id: COINCIDENCIA, codigo: FOLIO, categoria: 'infraestructura',
      reportado_hace_minutos: 12, adhesiones,
    },
  }
}

function renderReportar(ruta = `/reportar?aula=${AULA}`) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route path="/reportar" element={<Reportar />} />
          <Route path="/" element={<p>Inicio</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function seleccionarFoto() {
  const archivo = new File(['foto'], 'foto.jpg', { type: 'image/jpeg' })
  fireEvent.change(screen.getByLabelText('Foto de la incidencia'), { target: { files: [archivo] } })
}

beforeEach(() => {
  dobles.analizarImagen.mockReset()
  dobles.registrarEventoIA.mockReset()
  dobles.registrarEventoIA.mockResolvedValue({})
  dobles.confirmarAdhesion.mockReset()
  dobles.procesarFoto.mockReset()
  dobles.procesarFoto.mockImplementation(async (archivo: File) => ({ evidencia: archivo, ia: archivo, miniatura: archivo, calidad: { nitidez: 500, brillo: 120, borrosa: false, oscura: false, sobreexpuesta: false }, ancho: 1, alto: 1 }))
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:foto') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  servidor.use(http.get(`${BASE}/aulas/${AULA}`, () => HttpResponse.json({
    id_publico: AULA, ubicacion: { edificio: 'Edificio A', piso: 1, aula: '101' },
  })))
})

describe('Reportar: posible duplicado (G8, T-038)', () => {
  it('manda el aula del QR al análisis', async () => {
    dobles.analizarImagen.mockReturnValue(new Promise(() => undefined))
    renderReportar()
    seleccionarFoto()
    await waitFor(() => expect(dobles.analizarImagen).toHaveBeenCalled())
    expect(dobles.analizarImagen.mock.calls[0][0].aula_id).toBe(AULA)
  })

  it('sin QR no manda aula al análisis', async () => {
    dobles.analizarImagen.mockReturnValue(new Promise(() => undefined))
    renderReportar('/reportar')
    seleccionarFoto()
    await waitFor(() => expect(dobles.analizarImagen).toHaveBeenCalled())
    expect(dobles.analizarImagen.mock.calls[0][0].aula_id).toBeUndefined()
  })

  it('muestra el aviso con folio, tiempo y personas, sin datos de quién reportó', async () => {
    dobles.analizarImagen.mockResolvedValue(respuestaDuplicado())
    renderReportar()
    seleccionarFoto()

    const aviso = await screen.findByRole('region', { name: /Esto ya fue reportado hace 12 min/ })
    expect(aviso).toHaveTextContent(FOLIO)
    expect(aviso).toHaveTextContent('2 personas más ya se sumaron')
    expect(aviso).toHaveTextContent('Infraestructura')
    expect(screen.getByRole('button', { name: 'Yo también lo vi' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Es otra falla, reportar igual' })).toBeEnabled()
  })

  it('"Yo también lo vi" se suma al reporte, cierra la oferta y no crea un reporte nuevo', async () => {
    const crear = vi.fn()
    servidor.use(http.post(`${BASE}/incidencias`, () => {
      crear()
      return HttpResponse.json({}, { status: 500 })
    }))
    dobles.analizarImagen.mockResolvedValue(respuestaDuplicado())
    dobles.confirmarAdhesion.mockResolvedValue({ ok: true, codigo: FOLIO, categoria: 'infraestructura', adhesiones: 3, registrada: true })
    renderReportar()
    seleccionarFoto()

    await userEvent.click(await screen.findByRole('button', { name: 'Yo también lo vi' }))

    expect(await screen.findByRole('heading', { name: `Te sumaste al reporte ${FOLIO}` })).toBeInTheDocument()
    expect(screen.getByText(/Ahora son 4 personas/)).toBeInTheDocument()
    expect(dobles.confirmarAdhesion).toHaveBeenCalledWith({ coincidencia_id: COINCIDENCIA, analisis_id: ID_ANALISIS })
    expect(crear).not.toHaveBeenCalled()
    expect(dobles.registrarEventoIA).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'Ir al inicio' })).toHaveAttribute('href', '/')
  })

  it('si ya se había sumado lo dice sin error', async () => {
    dobles.analizarImagen.mockResolvedValue(respuestaDuplicado())
    dobles.confirmarAdhesion.mockResolvedValue({ ok: true, codigo: FOLIO, categoria: 'infraestructura', adhesiones: 3, registrada: false })
    renderReportar()
    seleccionarFoto()
    await userEvent.click(await screen.findByRole('button', { name: 'Yo también lo vi' }))
    expect(await screen.findByText(/Ya te habías sumado/)).toBeInTheDocument()
  })

  it('"Es otra falla, reportar igual" oculta el aviso y deja el formulario prellenado', async () => {
    dobles.analizarImagen.mockResolvedValue(respuestaDuplicado(0))
    renderReportar()
    seleccionarFoto()

    const aviso = await screen.findByRole('region', { name: /Esto ya fue reportado/ })
    expect(aviso).toHaveTextContent('aún nadie más se ha sumado')
    await userEvent.click(screen.getByRole('button', { name: 'Es otra falla, reportar igual' }))

    expect(screen.queryByRole('region', { name: /Esto ya fue reportado/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Título')).toHaveValue('Luminaria fundida')
    expect(screen.getByRole('button', { name: 'Enviar reporte' })).toBeEnabled()
    expect(dobles.confirmarAdhesion).not.toHaveBeenCalled()
  })

  it('si la coincidencia venció avisa y sigue con el formulario', async () => {
    dobles.analizarImagen.mockResolvedValue(respuestaDuplicado())
    dobles.confirmarAdhesion.mockRejectedValue(new ApiError(404, 'no_encontrado', 'Coincidencia no encontrada'))
    renderReportar()
    seleccionarFoto()
    await userEvent.click(await screen.findByRole('button', { name: 'Yo también lo vi' }))

    expect(await screen.findByText(/La coincidencia ya venció/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /Esto ya fue reportado/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enviar reporte' })).toBeEnabled()
  })

  it('un error de red deja el aviso para reintentar', async () => {
    dobles.analizarImagen.mockResolvedValue(respuestaDuplicado())
    dobles.confirmarAdhesion.mockRejectedValue(new ApiError(0, 'red', 'Sin conexión con el servidor'))
    renderReportar()
    seleccionarFoto()
    await userEvent.click(await screen.findByRole('button', { name: 'Yo también lo vi' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Sin conexión con el servidor')
    expect(screen.getByRole('button', { name: 'Yo también lo vi' })).toBeEnabled()
  })
})
