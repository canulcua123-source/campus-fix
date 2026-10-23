import type { IncidenciaListaItem } from '../schemas/incidencia'
import { haceCuanto } from './tiempo'

export type PestanaBandeja = 'mias' | 'sin_asignar'

const ORDEN_PRIORIDAD: Record<string, number> = {
  critica: 0,
  alta: 1,
  media: 2,
  baja: 3,
}

function instante(fecha: string): number {
  const valor = new Date(fecha).getTime()
  return Number.isNaN(valor) ? 0 : valor
}

/** Mías = asignadas a la persona en sesión. Sin `nombre` se consideran todas las asignadas. */
export function esMia(incidencia: IncidenciaListaItem, nombre?: string | null): boolean {
  const tecnico = incidencia.tecnico_asignado
  if (!tecnico) return false
  return !nombre || tecnico.nombre === nombre
}

export function filtrarBandeja(
  incidencias: readonly IncidenciaListaItem[],
  pestana: PestanaBandeja,
  nombre?: string | null,
): IncidenciaListaItem[] {
  return incidencias.filter((i) => (pestana === 'mias' ? esMia(i, nombre) : !i.tecnico_asignado))
}

/** Crítica > alta > media > baja y, a igual prioridad, la más antigua primero. */
export function ordenarBandeja(incidencias: readonly IncidenciaListaItem[]): IncidenciaListaItem[] {
  return [...incidencias].sort((a, b) => {
    const prioridad = (ORDEN_PRIORIDAD[a.prioridad] ?? 99) - (ORDEN_PRIORIDAD[b.prioridad] ?? 99)
    return prioridad !== 0 ? prioridad : instante(a.fecha_creacion) - instante(b.fecha_creacion)
  })
}

export function horasAntiguedad(fecha: string, ahora = Date.now()): number {
  return Math.max(0, (ahora - instante(fecha)) / 3_600_000)
}

/** Texto e intensidad del indicador de SLA según la antigüedad. */
export function antiguedad(fecha: string, ahora = Date.now()): { texto: string; nivel: 'normal' | 'atencion' | 'vencida' } {
  const horas = horasAntiguedad(fecha, ahora)
  const nivel = horas >= 24 ? 'vencida' : horas >= 8 ? 'atencion' : 'normal'
  return { texto: haceCuanto(fecha, ahora), nivel }
}
