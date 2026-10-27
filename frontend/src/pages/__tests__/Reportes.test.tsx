// @vitest-environment jsdom
import '../../test/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BASE } from '../../api/client'
import { useAuth } from '../../auth/store'
import { servidor } from '../../test/msw/server'
import Reportes from '../Reportes'

const DATOS = {
  resumen: { abiertas: 11, en_proceso: 4, criticas: 2, resueltas_periodo: 6 },
  edificios: [
    { edificio: 'B', total: 2, horas_invertidas: 9, horas_resolucion_prom: null },
    { edificio: 'A', total: 5, horas_invertidas: 14.5, horas_resolucion_prom: 8.2 },
  ],
  tags: [{ tag: 'wifi', total: 7 }],
  tendencia: [
    { periodo: '2026-09', categoria: 'computo_redes', total: 3 },
    { periodo: '2026-10', categoria: 'infraestructura', total: 2 },
    { periodo: '2026-10', categoria: 'computo_redes', total: 1 },
  ],
  'aulas-cronicas': [{ edificio: 'A', piso: 2, aula: '204', total: 4 }],
}
type Seccion = keyof typeof DATOS

const incidencia = (id: string, fecha: string, estado = 'abierta', titulo = 'Proyector sin señal') => ({
  _id: id, codigo: `CR-2026-${id.padStart(4, '0')}`, titulo, categoria: 'computo_redes', estado, prioridad: 'alta',
  ubicacion: { edificio: 'A', piso: 2, aula: '204' }, tags: [], fecha_creacion: fecha,
})

function preparar(opciones: {
  datos?: Partial<Record<Seccion, unknown>>
  conError?: Seccion
  incidencias?: (estado: string) => unknown[]
} = {}) {
  const peticiones: { ruta: string; params: URLSearchParams }[] = []
  for (const seccion of Object.keys(DATOS) as Seccion[]) {
    servidor.use(http.get(`${BASE}/analitica/${seccion}`, ({ request }) => {
      peticiones.push({ ruta: seccion, params: new URL(request.url).searchParams })
      if (seccion === opciones.conError) return HttpResponse.json({ error: 'no_disponible' }, { status: 503 })
      return HttpResponse.json(opciones.datos?.[seccion] ?? DATOS[seccion])
    }))
  }
  servidor.use(http.get(`${BASE}/incidencias`, ({ request }) => {
    const params = new URL(request.url).searchParams
    peticiones.push({ ruta: 'incidencias', params })
    return HttpResponse.json(opciones.incidencias?.(params.get('estado') ?? '') ?? [])
  }))
  useAuth.setState({
    token: 'token-falso',
    usuario: { nombre: 'Directora', rol: 'directivo', alcance: 'global', permisos: ['analitica:ver', 'incidencias:ver'] },
  })
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter><Reportes /></MemoryRouter>
    </QueryClientProvider>,
  )
  return { peticiones }
}

function espiarDescarga() {
  const blobs: Blob[] = []
  const crear = vi.fn((b: Blob) => { blobs.push(b); return 'blob:reporte' })
  Object.assign(URL, { createObjectURL: crear, revokeObjectURL: vi.fn() })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const leer = () => new Promise<string>((ok) => {
    const lector = new FileReader()
    lector.onload = () => ok(lector.result as string)
    lector.readAsText(blobs[0])
  })
  return { blobs, click, leer }
}

afterEach(() => vi.restoreAllMocks())

describe('Reportes', () => {
  it('muestra skeleton y luego el resumen ejecutivo en tablas', async () => {
    preparar()
    expect(screen.getByRole('heading', { name: 'Reportes' })).toBeInTheDocument()
    expect(screen.getByLabelText('Cargando indicadores')).toBeInTheDocument()

    const kpis = await screen.findByRole('table', { name: 'Indicadores principales' })
    expect(within(kpis).getByRole('rowheader', { name: 'Abiertas' }).closest('tr')).toHaveTextContent('11')
    const edificios = await screen.findByRole('table', { name: /Edificios con más/ })
    expect(within(edificios).getAllByRole('rowheader').map((n) => n.textContent)).toEqual(['A', 'B'])
    expect(within(edificios).getByText('Sin dato')).toBeInTheDocument()
    expect(await screen.findByRole('table', { name: 'Etiquetas más frecuentes' })).toHaveTextContent('wifi')
    const tendencia = await screen.findByRole('table', { name: 'Tendencia mensual' })
    const filaOct = within(tendencia).getByRole('rowheader', { name: /octubre.*2026/ }).closest('tr')!
    expect(within(filaOct).getAllByRole('cell').map((c) => c.textContent)).toEqual(['1', '2', '0', '3'])
    expect(within(tendencia).getByRole('columnheader', { name: 'Cómputo y redes' })).toBeInTheDocument()
    expect(await screen.findByRole('table', { name: 'Aulas crónicas' })).toHaveTextContent('204')
    expect(screen.getByText('Todo el historial disponible', { exact: false })).toBeInTheDocument()
  })

  it('valida el periodo y lo envía a todas las secciones', async () => {
    const { peticiones } = preparar()
    await screen.findByRole('table', { name: 'Indicadores principales' })
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-20' } })
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-01' } })
    expect(screen.getByText('Desde debe ser igual o anterior a Hasta')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aplicar periodo' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-31' } })
    peticiones.length = 0
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar periodo' }))
    await waitFor(() => expect(peticiones).toHaveLength(5))
    expect(peticiones.every((p) => p.params.get('desde') === '2026-10-20' && p.params.get('hasta') === '2026-10-31')).toBe(true)
    expect(await screen.findByText(/Del 20 de octubre de 2026 al 31 de octubre de 2026/)).toBeInTheDocument()
  })

  it('muestra error con Reintentar por sección y estados vacíos', async () => {
    preparar({ conError: 'tendencia', datos: { tags: [], 'aulas-cronicas': [] } })
    expect(await screen.findByText('Sin etiquetas')).toBeInTheDocument()
    expect(await screen.findByText('Sin aulas crónicas')).toBeInTheDocument()
    const reintentar = await screen.findByRole('button', { name: /Reintentar/ })
    servidor.use(http.get(`${BASE}/analitica/tendencia`, () => HttpResponse.json(DATOS.tendencia)))
    fireEvent.click(reintentar)
    expect(await screen.findByRole('table', { name: 'Tendencia mensual' })).toBeInTheDocument()
  })

  it('descarga CSV del periodo con BOM y etiquetas legibles', async () => {
    const { blobs, click, leer } = espiarDescarga()
    const { peticiones } = preparar({
      incidencias: (estado) => estado === 'abierta'
        ? [incidencia('2', '2026-10-15T10:00:00Z', 'abierta', 'Falla, "urgente"'), incidencia('1', '2026-09-01T10:00:00Z')]
        : estado === 'en_proceso' ? [incidencia('3', '2026-10-02T10:00:00Z', 'en_proceso')] : [],
    })
    await screen.findByRole('table', { name: 'Indicadores principales' })
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar periodo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Descargar CSV' }))

    expect(await screen.findByText('Se descargó el CSV con 2 incidencias.')).toBeInTheDocument()
    expect(click).toHaveBeenCalledTimes(1)
    const consultas = peticiones.filter((p) => p.ruta === 'incidencias')
    expect(consultas).toHaveLength(6)
    expect(consultas.every((p) => p.params.get('limite') === '100')).toBe(true)
    expect(blobs[0].type).toContain('text/csv')
    const texto = await leer()
    const lineas = texto.replace(/^﻿/, '').trim().split('\r\n')
    expect(lineas[0]).toBe('Folio,Título,Categoría,Prioridad,Estado,Edificio,Piso,Aula,Técnico asignado,Fecha de creación')
    expect(lineas).toHaveLength(3)
    expect(lineas[1]).toContain('CR-2026-0002,"Falla, ""urgente""",Cómputo y redes,Alta,Abierta')
    expect(lineas[2]).toContain('En proceso')
    expect(texto).not.toContain('CR-2026-0001')
  })

  it('avisa cuando el CSV queda truncado y cuando no hay incidencias', async () => {
    espiarDescarga()
    let llenas = true
    preparar({
      incidencias: () => llenas
        ? Array.from({ length: 100 }, (_, n) => incidencia(String(n + 1), new Date(Date.UTC(2026, 9, 25) - n * 60_000).toISOString()))
        : [],
    })
    await screen.findByRole('table', { name: 'Indicadores principales' })
    fireEvent.click(screen.getByRole('button', { name: 'Descargar CSV' }))
    expect(await screen.findByText(/El archivo está incompleto/)).toBeInTheDocument()

    llenas = false
    fireEvent.click(screen.getByRole('button', { name: 'Descargar CSV' }))
    expect(await screen.findByText(/No hay incidencias en el periodo seleccionado/)).toBeInTheDocument()
  })

  it('muestra error si falla la consulta de incidencias', async () => {
    preparar()
    servidor.use(http.get(`${BASE}/incidencias`, () => HttpResponse.json({ error: 'no_disponible' }, { status: 503 })))
    await screen.findByRole('table', { name: 'Indicadores principales' })
    fireEvent.click(screen.getByRole('button', { name: 'Descargar CSV' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('imprime con window.print', async () => {
    const imprimir = vi.spyOn(window, 'print').mockImplementation(() => {})
    preparar()
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir / PDF' }))
    expect(imprimir).toHaveBeenCalledTimes(1)
  })
})
