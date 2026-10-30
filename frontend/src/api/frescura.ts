import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { claves } from './keys'

/**
 * Frescura de datos entre usuarios (sin WebSocket): las pantallas operativas se refrescan solas
 * mientras la pestaña está visible. TanStack pausa el intervalo con la pestaña oculta
 * (`refetchIntervalInBackground: false`) y refresca al volver (`refetchOnWindowFocus`).
 *
 * Presupuesto contra el límite de la API (por usuario): general 300/min; consulta pesada 30/min por endpoint.
 * Bandeja con panel abierto = 2 listas + detalle cada 30 s = 6/min por pestaña; Centro de control = 3/min.
 */
export const INTERVALO_OPERATIVO = 30_000
/** Endpoints con límite de consulta pesada (/sistema/resumen, /analitica/*): 1/min por pestaña. */
export const INTERVALO_PESADO = 60_000

export const refrescoOperativo = {
  refetchInterval: INTERVALO_OPERATIVO,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
} as const

export const refrescoPesado = { ...refrescoOperativo, refetchInterval: INTERVALO_PESADO } as const

function invalidarTodas(qc: QueryClient, llaves: QueryKey[]) {
  return Promise.all(llaves.map((queryKey) => qc.invalidateQueries({ queryKey })))
}

/**
 * Tras cualquier cambio de una incidencia (estado, asignación, prioridad, tomar, seguimiento, confirmación,
 * retiro, tags, comentarios, evidencias): detalle + todas las listas (cualquier filtro y búsqueda, por prefijo)
 * + analítica (KPIs, carga de técnicos) + Centro de control. Devuelve la promesa para que la mutación siga
 * «pendiente» hasta que llegan los datos nuevos (sin parpadeo del valor anterior).
 */
export function invalidarIncidencia(qc: QueryClient, id?: string) {
  return invalidarTodas(qc, [
    ...(id ? [claves.incidencia(id)] : []),
    claves.incidencias,
    claves.analitica,
    claves.sistemaResumen,
  ])
}

/** Cambios de administración: además del recurso, la bitácora y el Centro de control (actividad reciente). */
export function invalidarAdmin(qc: QueryClient, ...llaves: QueryKey[]) {
  return invalidarTodas(qc, [...llaves, claves.auditoria, claves.sistemaResumen])
}
