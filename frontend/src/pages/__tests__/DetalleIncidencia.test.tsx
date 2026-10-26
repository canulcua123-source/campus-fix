// @vitest-environment jsdom
import "../../test/setup"
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { BASE } from '../../api/client'
import { useAuth } from '../../auth/store'
import type { IncidenciaDetalle } from '../../schemas/incidencia'
import { servidor } from '../../test/msw/server'
import DetalleIncidencia from '../DetalleIncidencia'

const ID = '664f1c2e9b1e8a3d4c5b6a70'
const RUTA = `${BASE}/incidencias/${ID}`
const RUTA_RETIRO = `${RUTA}/retirar`

function detalle(categoria: IncidenciaDetalle['categoria'] = 'infraestructura'): IncidenciaDetalle {
  const comunes = {
    _id: ID,
    codigo: 'INC-2026-1023-INF-0001',
    titulo: 'Luminaria fundida',
    estado: 'abierta' as const,
    prioridad: 'media' as const,
    ubicacion: { edificio: 'Edificio B', piso: 2, aula: 'B-204' },
    tags: ['iluminacion'],
    fecha_creacion: '2026-10-23T09:00:00Z',
    descripcion: 'La lámpara del pasillo no enciende.',
    reportante: { usuario_id: 'reportante', nombre: 'Ana López' },
    evidencias_adjuntas: [],
    horas_invertidas: 0,
    historial_seguimiento: [],
    puede_retirar: false,
  }
  if (categoria === 'computo_redes') {
    return {
      ...comunes,
      categoria,
      detalle_especifico: { categoria, ip: '10.0.0.8', vlan: 20, puerto_uplink: 'Gi0/1', equipos_afectados: 3 },
    }
  }
  if (categoria === 'academico') {
    return {
      ...comunes,
      categoria,
      detalle_especifico: { categoria, plataforma: 'lms', codigo_curso: 'MAT-101', periodo: '2026-1', estudiantes_impactados: 42 },
    }
  }
  return {
    ...comunes,
    categoria,
    detalle_especifico: {
      categoria, tipo_dano: 'luminaria', riesgo_seguridad: 'bajo', requiere_insumos: false, requiere_contratista: false,
    },
  }
}

function renderDetalle() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[`/incidencias/${ID}`]}>
        <Routes><Route path="/incidencias/:id" element={<DetalleIncidencia />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function responderDetalle(incidencia: IncidenciaDetalle) {
  servidor.use(http.get(RUTA, () => HttpResponse.json(incidencia)))
}

describe('DetalleIncidencia (T-046)', () => {
  it.each(['computo_redes', 'infraestructura', 'academico'] as const)(
    'renderiza detalle polimórfico por categoría: %s',
    async (categoria) => {
      responderDetalle(detalle(categoria))
      renderDetalle()

      if (categoria === 'computo_redes') expect(await screen.findByText('10.0.0.8')).toBeInTheDocument()
      if (categoria === 'infraestructura') expect(await screen.findByText('Luminaria')).toBeInTheDocument()
      if (categoria === 'academico') expect(await screen.findByText('MAT-101')).toBeInTheDocument()
    },
  )

  it('muestra el timeline ordenado cronológicamente', async () => {
    const incidencia = detalle()
    incidencia.historial_seguimiento = [
      { fecha: '2026-10-23T12:00:00Z', usuario_id: 'tecnico', estado_nuevo: 'en_proceso', comentario: 'Tercero', horas: 1 },
      { fecha: '2026-10-23T08:00:00Z', usuario_id: 'reportante', estado_nuevo: 'abierta', comentario: 'Primero', horas: 0 },
      { fecha: '2026-10-23T10:00:00Z', usuario_id: 'tecnico', estado_nuevo: 'en_proceso', comentario: 'Segundo', horas: 0.5 },
    ]
    responderDetalle(incidencia)
    renderDetalle()

    const bitacora = await screen.findByRole('list')
    const texto = bitacora.textContent ?? ''
    expect(texto.indexOf('Primero')).toBeLessThan(texto.indexOf('Segundo'))
    expect(texto.indexOf('Segundo')).toBeLessThan(texto.indexOf('Tercero'))
  })

  it('mantiene el detalle en solo lectura para directivo', async () => {
    useAuth.setState({
      usuario: { nombre: 'Directora', rol: 'directivo', permisos: ['incidencias:ver', 'analitica:ver'], alcance: 'global' },
    })
    responderDetalle(detalle())
    renderDetalle()

    expect(await screen.findByText('Solo lectura')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /registrar seguimiento|editar etiquetas|asignar/i })).not.toBeInTheDocument()
  })

  it('muestra una pantalla amigable si la incidencia no existe', async () => {
    servidor.use(http.get(RUTA, () => HttpResponse.json({ error: 'no_encontrado' }, { status: 404 })))
    renderDetalle()

    expect(await screen.findByText('No encontramos esta incidencia')).toBeInTheDocument()
    expect(screen.getByText(/fuera de tu alcance/i)).toBeInTheDocument()
  })

  it('pide la URL firmada solo al abrir una evidencia', async () => {
    const incidencia = detalle()
    incidencia.evidencias_adjuntas = [{
      evidencia_id: 'ev-1', nombre_archivo: 'pasillo.jpg', tipo_mime: 'image/jpeg', peso_kb: 42,
      url_storage: 'incidencias/pasillo.jpg', fecha_carga: '2026-10-23T09:00:00Z', subido_por: 'reportante',
    }]
    let consultasUrl = 0
    responderDetalle(incidencia)
    servidor.use(http.get(`${RUTA}/evidencias/ev-1/url`, () => {
      consultasUrl += 1
      return HttpResponse.json({ url: 'https://ejemplo.test/pasillo.jpg', expira_en: 300 })
    }))
    renderDetalle()

    const usuario = userEvent.setup()
    const abrir = await screen.findByRole('button', { name: 'Ver pasillo.jpg' })
    expect(consultasUrl).toBe(0)
    await usuario.click(abrir)
    expect(await screen.findByAltText('pasillo.jpg')).toHaveAttribute('src', 'https://ejemplo.test/pasillo.jpg')
    expect(consultasUrl).toBe(1)
  })

  it.each([
    ['de otro usuario', { puede_retirar: false }],
    ['fuera de la ventana', { puede_retirar: false }],
    ['asignada', { puede_retirar: false, tecnico_asignado: { usuario_id: 'tecnico', nombre: 'Técnico' } }],
    ['ya retirada', { puede_retirar: false, estado: 'retirada' as const }],
  ])('oculta Retirar mi reporte cuando la incidencia está %s', async (_caso, cambios) => {
    responderDetalle({ ...detalle(), ...cambios })
    renderDetalle()
    await screen.findByText('Luminaria fundida')
    expect(screen.queryByRole('button', { name: 'Retirar mi reporte' })).not.toBeInTheDocument()
  })

  it('permite cancelar la confirmación sin enviar la solicitud', async () => {
    const incidencia = { ...detalle(), puede_retirar: true }
    let solicitudes = 0
    responderDetalle(incidencia)
    servidor.use(http.post(RUTA_RETIRO, () => {
      solicitudes += 1
      return HttpResponse.json({ ok: true, estado: 'retirada' })
    }))
    renderDetalle()

    const usuario = userEvent.setup()
    await usuario.click(await screen.findByRole('button', { name: 'Retirar mi reporte' }))
    const dialogo = screen.getByRole('dialog', { name: 'Confirmar retiro' })
    expect(within(dialogo).getByText(/dejará de ser atendido/i)).toBeInTheDocument()
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByRole('dialog', { name: 'Confirmar retiro' })).not.toBeInTheDocument()
    expect(solicitudes).toBe(0)
  })

  it('retira una incidencia, evita envíos repetidos y actualiza el estado', async () => {
    const incidencia = { ...detalle(), puede_retirar: true }
    let solicitudes = 0
    responderDetalle(incidencia)
    servidor.use(http.post(RUTA_RETIRO, async () => {
      solicitudes += 1
      await delay(80)
      incidencia.estado = 'retirada'
      incidencia.puede_retirar = false
      return HttpResponse.json({ ok: true, estado: 'retirada' })
    }))
    renderDetalle()

    const usuario = userEvent.setup()
    await usuario.click(await screen.findByRole('button', { name: 'Retirar mi reporte' }))
    const confirmar = within(screen.getByRole('dialog', { name: 'Confirmar retiro' }))
      .getByRole('button', { name: 'Sí, retirar reporte' })
    await usuario.click(confirmar)
    expect(confirmar).toBeDisabled()
    await usuario.click(confirmar)

    expect(await screen.findByRole('status')).toHaveTextContent('Tu reporte fue retirado correctamente')
    expect(await screen.findByText('Retirada')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retirar mi reporte' })).not.toBeInTheDocument()
    expect(solicitudes).toBe(1)
  })

  it('conserva el estado abierto y explica el conflicto 409', async () => {
    responderDetalle({ ...detalle(), puede_retirar: true })
    servidor.use(http.post(RUTA_RETIRO, () => HttpResponse.json(
      { error: 'conflicto', detalle: 'La incidencia ya no puede retirarse' },
      { status: 409 },
    )))
    renderDetalle()

    const usuario = userEvent.setup()
    await usuario.click(await screen.findByRole('button', { name: 'Retirar mi reporte' }))
    await usuario.click(within(screen.getByRole('dialog', { name: 'Confirmar retiro' }))
      .getByRole('button', { name: 'Sí, retirar reporte' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/ya no puede retirarse/i)
    await waitFor(() => expect(screen.getByText('Abierta')).toBeInTheDocument())
    expect(screen.queryByText('Tu reporte fue retirado correctamente.')).not.toBeInTheDocument()
  })
})
