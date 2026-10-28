// @vitest-environment jsdom
import '../../test/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { BASE } from '../../api/client'
import { useAuth } from '../../auth/store'
import { sesionDe } from '../../test/roles'
import { servidor } from '../../test/msw/server'
import InicioPorRol from '../InicioPorRol'
import CentroControl from '../CentroControl'

const SALUD = {
  estado: 'degradado', version: '0.1.0', uptime_segundos: 7_500, fecha: '2026-10-28T12:00:00+00:00',
  mongo: { estado: 'ok', detalle: 'Responde', latencia_ms: 3.2 },
  redis: { estado: 'ok', detalle: 'Responde', latencia_ms: 1.1 },
  almacenamiento: { estado: 'error', detalle: 'Sin configurar: no se pueden subir evidencias' },
  ia: {
    estado: 'advertencia', detalle: 'Cupo diario por agotarse', habilitada: true, proveedor: 'gemini', modelo: 'gemini-3.5-flash',
    usados_hoy: 270, limite_diario: 300, porcentaje_cupo: 90,
  },
}
const RESUMEN = {
  kpis: { abiertas: 12, criticas_sin_asignar: 2, vencidas: 5, resueltas_hoy: 3, resueltas_semana: 17, horas_resolucion_prom: 6.5 },
  alertas: [
    { tipo: 'criticas_sin_asignar', severidad: 'critica', titulo: 'Críticas sin asignar', detalle: 'Llevan más de 4 h sin técnico asignado', total: 2, enlace: '/tablero' },
    { tipo: 'cupo_ia', severidad: 'advertencia', titulo: 'Cupo diario de IA', detalle: '270 de 300 análisis usados hoy', total: 270, enlace: '/admin/configuracion' },
  ],
  top_edificios: [{ clave: 'Edificio A', total: 9 }],
  top_categorias: [{ clave: 'computo_redes', total: 6 }],
  carga_tecnicos: [{ tecnico_id: '664f1c2e9b1e8a3d4c5b6a71', nombre: 'Ana López', incidencias_activas: 4, horas_acumuladas: 7.5 }],
}
const AUDITORIA = {
  pagina: 1, limite: 10, total: 1,
  resultados: [{
    _id: 'e1', actor_id: 'a1', accion: 'crear', recurso: 'roles', recurso_id: 'jefe', despues: { clave: 'jefe_edificio' },
    fecha: '2026-10-28T11:00:00+00:00',
  }],
}

function mocks({ resumenFalla = false, sinAlertas = false } = {}) {
  let llamadasResumen = 0
  servidor.use(
    http.get(`${BASE}/sistema/salud`, () => HttpResponse.json(SALUD)),
    http.get(`${BASE}/sistema/resumen`, () => {
      llamadasResumen += 1
      if (resumenFalla && llamadasResumen === 1) return HttpResponse.json({ error: 'no_disponible', detalle: 'Caído' }, { status: 503 })
      return HttpResponse.json(sinAlertas ? { ...RESUMEN, alertas: [] } : RESUMEN)
    }),
    http.get(`${BASE}/auditoria`, () => HttpResponse.json(AUDITORIA)),
  )
  useAuth.setState({ token: 't', usuario: sesionDe('superadmin') })
}

function montar(ruta = '/control') {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route path="/" element={<InicioPorRol />} />
          <Route path="/control" element={<CentroControl />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CentroControl', () => {
  it('muestra KPIs, alertas con enlace, salud con texto y actividad', async () => {
    mocks()
    montar()
    expect(await screen.findByText('Críticas sin asignar', { selector: '.ui-stat__etiqueta' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('6.5 h')).toBeInTheDocument())
    const alerta = screen.getByRole('link', { name: /Críticas sin asignar/ })
    expect(alerta).toHaveAttribute('href', '/tablero')
    expect(screen.getByRole('link', { name: /Cupo diario de IA/ })).toHaveAttribute('href', '/admin/configuracion')
    // Salud: estado con texto, nunca solo color.
    expect(await screen.findByText('Servicio degradado')).toBeInTheDocument()
    expect(screen.getByText('Falla')).toBeInTheDocument()
    expect(screen.getByText(/Cupo de hoy: 270 de 300/)).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Categorías con más reportes' })).toHaveTextContent('Cómputo y redes')
    expect(screen.getByRole('table', { name: 'Carga de técnicos' })).toHaveTextContent('Ana López')
    expect(await screen.findByText('Creó un rol jefe_edificio')).toBeInTheDocument()
    const accesos = screen.getByRole('navigation', { name: 'Accesos rápidos' })
    expect(within(accesos).getByRole('link', { name: /Configuración/ })).toHaveAttribute('href', '/admin/configuracion')
  })

  it('sin alertas muestra estado vacío', async () => {
    mocks({ sinAlertas: true })
    montar()
    expect(await screen.findByText('Sin alertas')).toBeInTheDocument()
  })

  it('error del resumen ofrece Reintentar', async () => {
    mocks({ resumenFalla: true })
    montar()
    const reintentar = await screen.findByRole('button', { name: /Reintentar/ })
    await userEvent.setup().click(reintentar)
    expect(await screen.findByText('Vencidas', { selector: '.ui-stat__etiqueta' })).toBeInTheDocument()
  })

  it('el superadmin que entra a «/» aterriza en el Centro de control', async () => {
    mocks()
    montar('/')
    expect(await screen.findByRole('heading', { name: 'Centro de control', level: 1 })).toBeInTheDocument()
  })
})
