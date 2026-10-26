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

/** Estados que siguen requiriendo trabajo del técnico: resuelta, cerrada y retirada salen de la bandeja. */
const ESTADOS_ACTIVOS: readonly string[] = ['abierta', 'en_proceso', 'en_espera']

/** Mías = asignadas a la persona en sesión (por id de usuario, no por nombre). Sin id no hay "mías". */
export function esMia(incidencia: IncidenciaListaItem, usuarioId?: string | null): boolean {
  return Boolean(usuarioId) && incidencia.tecnico_asignado?.usuario_id === usuarioId
}

export function filtrarBandeja(
  incidencias: readonly IncidenciaListaItem[],
  pestana: PestanaBandeja,
  usuarioId?: string | null,
): IncidenciaListaItem[] {
  return incidencias
    .filter((i) => ESTADOS_ACTIVOS.includes(i.estado))
    .filter((i) => (pestana === 'mias' ? esMia(i, usuarioId) : !i.tecnico_asignado))
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
