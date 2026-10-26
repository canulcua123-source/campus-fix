import type { IncidenciaDetalle } from '../schemas/incidencia'

export type Estado = IncidenciaDetalle['estado']

/** Tabla 9.4: transiciones admitidas por el API desde cada estado actual. */
export const TRANSICIONES: Record<Estado, readonly Estado[]> = {
  abierta: ['en_proceso', 'en_espera'],
  en_proceso: ['en_espera', 'resuelta'],
  en_espera: ['en_proceso'],
  resuelta: ['cerrada', 'en_proceso'],
  cerrada: [],
}

const ETIQUETAS: Record<Estado, string> = {
  abierta: 'Abierta',
  en_proceso: 'En proceso',
  en_espera: 'En espera',
  resuelta: 'Resuelta',
  cerrada: 'Cerrada',
}

export function transicionesDesde(estado: Estado): readonly Estado[] {
  return TRANSICIONES[estado]
}

export function etiquetaEstado(estado: Estado): string {
  return ETIQUETAS[estado]
}
