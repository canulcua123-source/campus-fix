// @vitest-environment jsdom
import '../../test/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { BASE } from '../../api/client'
import { RequirePermiso } from '../../auth/RequirePermiso'
import { useAuth } from '../../auth/store'
import { rangoUltimosDias } from '../../lib/fechas'
import type { MetricasIA as RespuestaMetricasIA } from '../../schemas/metricasIA'
import { servidor } from '../../test/msw/server'
import MetricasIA from '../MetricasIA'

const RESPUESTA: RespuestaMetricasIA = {
  periodo: { desde: '2026-10-01T00:00:00Z', hasta: '2026-10-26T00:00:00Z' },
  totales: { ofertas: 10, editadas: 2, deshechas: 1, enviadas: 7, duplicados_sumados: 1, fallback: 1 },
  tasa_deshacer: { numerador: 1, denominador: 10, porcentaje: 10, disponible: true },
  tasa_edicion: { numerador: 2, denominador: 10, porcentaje: 20, disponible: true },
  correccion_tecnica_72h: { numerador: 0, denominador: 0, porcentaje: null, disponible: false, motivo: 'Historial no disponible.' },
  cobertura_agentica: { numerador: 7, denominador: 14, porcentaje: 50, disponible: true },
  tiempo_toque_folio: { muestras: 7, promedio_ms: 14_000, p50_ms: 13_000, p95_ms: 19_000 },
  compuertas_fallidas: [{ compuerta: 'G3', total: 4 }, { compuerta: 'G5', total: 2 }],
  latencia_ia: { muestras: 10, promedio_ms: 2200, p50_ms: 2000, p95_ms: 4000 },
  errores_ia: 1,
  timeouts_ia: 1,
  costos: {
    costo_estimado_periodo_usd: 0.42,
    llamadas_con_costo: 10,
    tokens_entrada: 1000,
    tokens_salida: 200,
    diario: [{ fecha: '2026-10-25', costo_estimado_usd: 0.42, llamadas_con_costo: 10 }],
    por_proveedor: [{ clave: 'claude', costo_estimado_usd: 0.42, llamadas_con_costo: 10 }],
    por_modelo: [{ clave: 'modelo-a', costo_estimado_usd: 0.42, llamadas_con_costo: 10 }],
    alerta: { configurada: true, activa: true, umbral_diario_usd: 0.4, dias_excedidos: ['2026-10-25'] },
  },
  semanal: [{ semana: '2026-10-19', ofertas: 10, deshechas: 1, editadas: 2, costo_estimado_usd: 0.42 }],
}

/** Valor mostrado por el StatTile cuya etiqueta es `etiqueta`. */
const valorDe = (etiqueta: string) => screen.getByText(etiqueta, { selector: '.ui-stat__etiqueta' })
  .closest('.ui-stat')?.querySelector('.ui-stat__valor')?.textContent

function preparar(respuesta: typeof RESPUESTA = RESPUESTA, estado = 200) {
  const urls: URL[] = []
  servidor.use(http.get(`${BASE}/analitica/ia`, ({ request }) => {
    urls.push(new URL(request.url))
    return HttpResponse.json(estado === 200 ? respuesta : { error: 'interno', detalle: 'No disponible' }, { status: estado })
  }))
  useAuth.setState({
    token: 'token-admin',
    usuario: { nombre: 'Administradora', rol: 'admin', alcance: 'global', permisos: ['analitica:ver'] },
  })
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={cliente}><MemoryRouter><MetricasIA /></MemoryRouter></QueryClientProvider>)
  return urls
}

describe('Métricas de IA T-035', () => {
  it('muestra indicadores reales, alerta, gráficas y tablas accesibles', async () => {
    preparar()
    await waitFor(() => expect(valorDe('Ofertas')).toBe('10'))
    expect(valorDe('Tasa de deshacer')).toBe('10 %')
    expect(valorDe('Corrección técnica ≤72 h')).toBe('No disponible')
    expect(screen.getByRole('alert')).toHaveTextContent('Umbral diario de costo superado')
    expect(screen.getByRole('img', { name: /costo estimado diario/i })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /compuertas de IA fallidas/i })).toBeInTheDocument()
    fireEvent.click(screen.getByText('Ver tabla de costos diarios'))
    expect(screen.getByRole('table', { name: /Costo estimado, no facturado/i })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: /Ofertas, decisiones y costo/i })).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('NaN')
  })

  it('aplica fechas, categoría, proveedor y modelo a una clave/consulta nueva', async () => {
    const urls = preparar()
    await waitFor(() => expect(valorDe('Ofertas')).toBe('10'))
    // Por defecto: últimos 30 días.
    expect(Object.fromEntries(urls[0].searchParams)).toEqual(rangoUltimosDias(30))
    await userEvent.click(screen.getByRole('button', { name: 'Personalizado' }))
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-25' } })
    await userEvent.selectOptions(screen.getByLabelText('Categoría'), 'infraestructura')
    // Fechas y categoría se aplican al instante.
    await waitFor(() => expect(Object.fromEntries(urls[urls.length - 1].searchParams)).toEqual({
      desde: '2026-10-01', hasta: '2026-10-25', categoria: 'infraestructura',
    }))
    // Proveedor y modelo viven en «Más filtros» y se aplican con el botón.
    await userEvent.click(screen.getByRole('button', { name: 'Más filtros' }))
    expect(screen.getByRole('button', { name: 'Aplicar filtros' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Proveedor'), 'claude')
    await userEvent.type(screen.getByLabelText('Modelo'), 'modelo-a')
    const antes = urls.length
    expect(urls.some((u) => u.searchParams.has('proveedor'))).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }))
    await waitFor(() => expect(urls.length).toBeGreaterThan(antes))
    expect(Object.fromEntries(urls[urls.length - 1].searchParams)).toEqual({
      desde: '2026-10-01', hasta: '2026-10-25', categoria: 'infraestructura', proveedor: 'claude', modelo: 'modelo-a',
    })
    expect(screen.getByRole('button', { name: 'Más filtros (2)' })).toBeInTheDocument()
  })

  it('muestra un estado vacío honesto sin costo ficticio', async () => {
    preparar({
      ...RESPUESTA,
      totales: { ofertas: 0, editadas: 0, deshechas: 0, enviadas: 0, duplicados_sumados: 0, fallback: 0 },
      tasa_deshacer: { numerador: 0, denominador: 0, porcentaje: null, disponible: true },
      tasa_edicion: { numerador: 0, denominador: 0, porcentaje: null, disponible: true },
      latencia_ia: { muestras: 0, promedio_ms: null, p50_ms: null, p95_ms: null },
      tiempo_toque_folio: { muestras: 0, promedio_ms: null, p50_ms: null, p95_ms: null },
      errores_ia: 0,
      timeouts_ia: 0,
      compuertas_fallidas: [],
      costos: { ...RESPUESTA.costos, costo_estimado_periodo_usd: null, llamadas_con_costo: 0, tokens_entrada: null, tokens_salida: null, diario: [], por_proveedor: [], por_modelo: [], alerta: { configurada: false, activa: false, umbral_diario_usd: null, dias_excedidos: [] } },
      semanal: [],
    })
    expect(await screen.findByText('Aún no hay telemetría de IA')).toBeInTheDocument()
    expect(screen.getByText(/aparecen cuando se reportan incidencias con foto/)).toBeInTheDocument()
    // Un solo estado vacío: sin indicadores «Sin datos» ni costo ficticio.
    expect(screen.queryByText('Ofertas', { selector: '.ui-stat__etiqueta' })).not.toBeInTheDocument()
    expect(screen.queryByText('Costo no disponible')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('$0')
    expect(screen.queryByText('Umbral diario de costo superado')).not.toBeInTheDocument()
  })

  it('muestra el error 500 con opción para reintentar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    preparar(RESPUESTA, 500)
    expect(await screen.findByText('No pudimos cargar la información')).toBeInTheDocument()
    expect(screen.getByText('No disponible')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('con ofertas en cero pero llamadas a la IA muestra indicadores y vacíos compactos', async () => {
    preparar({ ...RESPUESTA, totales: { ...RESPUESTA.totales, ofertas: 0 }, compuertas_fallidas: [], costos: { ...RESPUESTA.costos, diario: [] } })
    await waitFor(() => expect(valorDe('Ofertas')).toBe('0'))
    expect(screen.getByText('Costo no disponible')).toBeInTheDocument()
    expect(screen.getByText('Sin compuertas fallidas')).toBeInTheDocument()
  })

  it('la ruta no monta el tablero para un usuario no administrador', async () => {
    let llamadas = 0
    servidor.use(http.get(`${BASE}/analitica/ia`, () => { llamadas += 1; return HttpResponse.json(RESPUESTA) }))
    useAuth.setState({
      token: 'token-directivo',
      usuario: { nombre: 'Directivo', rol: 'directivo', alcance: 'global', permisos: ['analitica:ver'] },
    })
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={cliente}><MemoryRouter initialEntries={['/admin/metricas-ia']}><Routes>
      <Route path="/" element={<p>Inicio autorizado</p>} />
      <Route path="/admin/metricas-ia" element={<RequirePermiso permiso="analitica:ver" rol="admin"><MetricasIA /></RequirePermiso>} />
    </Routes></MemoryRouter></QueryClientProvider>)
    // T-071: por URL sin el rol muestra «Sin acceso» en lugar de redirigir.
    expect(await screen.findByRole('heading', { name: 'Sin acceso' })).toBeInTheDocument()
    expect(llamadas).toBe(0)
  })
})
