// @vitest-environment jsdom
import '../../test/setup'
import { QueryClientProvider, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { servidor } from '../../test/msw/server'
import { cargaTecnicosQuery } from '../analitica'
import { BASE } from '../client'
import { INTERVALO_OPERATIVO, INTERVALO_PESADO } from '../frescura'
import { useEditarRol, useEditarUsuario } from '../hooks/admin'
import { useAsignar, useConfirmacion, usePrioridad, useSeguimiento, useTomar } from '../hooks/incidencias'
import { incidenciaQuery, incidenciasQuery } from '../incidencias'
import { claves } from '../keys'
import { crearQueryClient } from '../queryClient'
import { resumenSistemaQuery } from '../sistema'
import config from '../../../vite.config.ts?raw'

const ID = '66f000000000000000000001'
const OTRA = '66f000000000000000000002'
const persona = { usuario_id: 'u2', nombre: 'Luis' }

/** Pantallas que muestran la incidencia: listas con filtros (objetos), búsqueda, detalle, KPIs y Centro de control. */
const DEPENDIENTES: QueryKey[] = [
  claves.incidencia(ID),
  claves.listaIncidencias({}),
  claves.listaIncidencias({ propias: true }),
  claves.listaIncidencias({ estado: 'abierta', tecnico: 'u2', edificio: 'A' }),
  claves.buscar('proyector'),
  claves.resumenFiltrado({ desde: '2026-10-01' }),
  claves.cargaTecnicos({}),
  ['analitica', 'tendencia', {}],
  claves.sistemaResumen,
]

function cacheSembrada() {
  const qc = crearQueryClient()
  for (const k of [...DEPENDIENTES, claves.incidencia(OTRA), claves.categorias]) qc.setQueryData(k, { semilla: true })
  return qc
}

const envoltorio = (qc: QueryClient) => ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
)

const invalidada = (qc: QueryClient, k: QueryKey) => qc.getQueryState(k)?.isInvalidated

function esperarInvalidacion(qc: QueryClient) {
  for (const k of DEPENDIENTES) expect(invalidada(qc, k), JSON.stringify(k)).toBe(true)
  // No se tira la caché de otras incidencias ni de catálogos.
  expect(invalidada(qc, claves.incidencia(OTRA))).toBe(false)
  expect(invalidada(qc, claves.categorias)).toBe(false)
}

describe('cambios de incidencia se reflejan en listas, detalle y KPIs', () => {
  it('asignación / reasignación', async () => {
    servidor.use(http.patch(`${BASE}/incidencias/${ID}/asignacion`, () => HttpResponse.json({ ok: true, tecnico_asignado: persona })))
    const qc = cacheSembrada()
    const { result } = renderHook(() => useAsignar(ID), { wrapper: envoltorio(qc) })
    await act(() => result.current.mutateAsync({ tecnico_id: '66f0000000000000000000aa' }))
    esperarInvalidacion(qc)
  })

  it('prioridad', async () => {
    servidor.use(http.patch(`${BASE}/incidencias/${ID}/prioridad`, () => HttpResponse.json({ ok: true, prioridad: 'critica' })))
    const qc = cacheSembrada()
    const { result } = renderHook(() => usePrioridad(ID), { wrapper: envoltorio(qc) })
    await act(() => result.current.mutateAsync({ prioridad: 'critica' }))
    esperarInvalidacion(qc)
  })

  it('estado (seguimiento)', async () => {
    servidor.use(http.patch(`${BASE}/incidencias/${ID}/seguimiento`, () => HttpResponse.json({ ok: true, estado: 'en_proceso' })))
    const qc = cacheSembrada()
    const { result } = renderHook(() => useSeguimiento(ID), { wrapper: envoltorio(qc) })
    await act(() => result.current.mutateAsync({ estado_nuevo: 'en_proceso', comentario: 'Reviso el equipo', horas: 1 }))
    esperarInvalidacion(qc)
  })

  it('tomar y confirmar', async () => {
    servidor.use(
      http.post(`${BASE}/incidencias/${ID}/tomar`, () => HttpResponse.json({ ok: true, estado: 'en_proceso', tecnico_asignado: persona })),
      http.post(`${BASE}/incidencias/${ID}/confirmacion`, () => HttpResponse.json({ ok: true, estado: 'cerrada' })),
    )
    const qc = cacheSembrada()
    const tomar = renderHook(() => useTomar(), { wrapper: envoltorio(qc) })
    await act(() => tomar.result.current.mutateAsync(ID))
    esperarInvalidacion(qc)

    const qc2 = cacheSembrada()
    const confirmar = renderHook(() => useConfirmacion(ID), { wrapper: envoltorio(qc2) })
    await act(() => confirmar.result.current.mutateAsync({ accion: 'confirmar' }))
    esperarInvalidacion(qc2)
  })

  it('409: refresca igualmente para mostrar el estado real', async () => {
    servidor.use(http.patch(`${BASE}/incidencias/${ID}/prioridad`, () => HttpResponse.json({ detail: 'Cambió' }, { status: 409 })))
    const qc = cacheSembrada()
    const { result } = renderHook(() => usePrioridad(ID), { wrapper: envoltorio(qc) })
    await act(() => result.current.mutateAsync({ prioridad: 'baja' }).catch(() => undefined))
    esperarInvalidacion(qc)
  })
})

describe('cambios de administración', () => {
  async function comprobar<V>(llaves: QueryKey[], hook: () => { mutateAsync: (v: V) => Promise<unknown> }, variables: V) {
    const qc = crearQueryClient()
    for (const k of llaves) qc.setQueryData(k, {})
    const { result } = renderHook(hook, { wrapper: envoltorio(qc) })
    await act(() => result.current.mutateAsync(variables))
    for (const k of llaves) expect(invalidada(qc, k), JSON.stringify(k)).toBe(true)
  }

  it('editar usuario refresca usuarios, técnicos asignables, sesión, carga y bitácora', async () => {
    servidor.use(http.patch(`${BASE}/usuarios/u2`, () => HttpResponse.json({ _id: 'u2', nombre: 'Luis', correo: 'l@utm.mx', rol: 'tecnico', activo: false })))
    await comprobar(
      [claves.usuarios, claves.tecnicos('computo_redes'), claves.me, claves.cargaTecnicos({}), claves.auditoriaFiltrada({ limite: 10 }), claves.sistemaResumen],
      useEditarUsuario,
      { id: 'u2', datos: { activo: false } },
    )
  })

  it('editar rol refresca roles, usuarios, sesión y bitácora', async () => {
    servidor.use(http.patch(`${BASE}/roles/r1`, () => HttpResponse.json({ _id: 'r1', clave: 'tecnico', nombre: 'Técnico', permisos: ['incidencias:ver'], alcance: 'area' })))
    await comprobar(
      [claves.roles, claves.usuarios, claves.me, claves.auditoriaFiltrada({ limite: 10 }), claves.sistemaResumen],
      useEditarRol,
      { id: 'r1', datos: { nombre: 'Técnico' } },
    )
  })
})

describe('frescura entre usuarios (polling solo con la pestaña visible)', () => {
  it('listas y detalle cada 30 s; resumen del sistema y carga cada 60 s', () => {
    for (const q of [incidenciasQuery({ propias: true }), incidenciasQuery({ estado: 'abierta' }), incidenciaQuery(ID)]) {
      expect(q.refetchInterval).toBe(INTERVALO_OPERATIVO)
      expect(q.refetchIntervalInBackground).toBe(false)
      expect(q.refetchOnWindowFocus).toBe(true)
    }
    for (const q of [resumenSistemaQuery(), cargaTecnicosQuery()]) {
      expect(q.refetchInterval).toBe(INTERVALO_PESADO)
      expect(q.refetchIntervalInBackground).toBe(false)
    }
    expect(INTERVALO_OPERATIVO).toBe(30_000)
    expect(INTERVALO_PESADO).toBeGreaterThanOrEqual(60_000) // límite de consulta pesada: 30/min por usuario
  })
})

describe('service worker', () => {
  it('no cachea respuestas de la API (siempre red)', () => {
    expect(config).toMatch(/runtimeCaching:\s*\[\s*\]/)
    expect(config).toMatch(/navigateFallbackDenylist:\s*\[\s*\/\^\\\/api\//)
    expect(config).not.toMatch(/NetworkFirst|StaleWhileRevalidate|CacheFirst/)
  })
})
