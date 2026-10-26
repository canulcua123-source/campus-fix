import { etiquetaDe } from '../components/ui/etiquetas'
import type { Estado, EstadoSeguimiento } from '../schemas/incidencia'

export type { Estado, EstadoSeguimiento }

/** Tabla 9.4 (`backend/app/dominio/estados.py`): destinos que el API admite desde cada estado actual. */
export const TRANSICIONES: Record<Estado, readonly EstadoSeguimiento[]> = {
  abierta: ['en_proceso', 'en_espera'],
  en_proceso: ['en_espera', 'resuelta'],
  en_espera: ['en_proceso'],
  resuelta: ['cerrada', 'en_proceso'],
  cerrada: [],
  retirada: [],
}

export function transicionesDesde(estado: Estado): readonly EstadoSeguimiento[] {
  return TRANSICIONES[estado]
}

export function etiquetaEstado(estado: Estado): string {
  return etiquetaDe('estado', estado)
}
