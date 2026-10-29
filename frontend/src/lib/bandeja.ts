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

/** Vistas de «Mis incidencias» (pantalla única del técnico, `?vista=`). */
export const VISTAS_BANDEJA = ['todas', 'asignadas', 'por_tomar', 'reportadas', 'resueltas'] as const
export type VistaBandeja = (typeof VISTAS_BANDEJA)[number]

export const esVistaBandeja = (valor: string | null): valor is VistaBandeja =>
  VISTAS_BANDEJA.includes(valor as VistaBandeja)

/** Resuelta por la persona en sesión: espera la confirmación del reportante. */
export function esResueltaPorMi(incidencia: IncidenciaListaItem, usuarioId?: string | null): boolean {
  return incidencia.estado === 'resuelta' && esMia(incidencia, usuarioId)
}

/** Une listas sin repetir `_id` (conserva la primera aparición y su orden). */
export function unirIncidencias(...listas: readonly (readonly IncidenciaListaItem[])[]): IncidenciaListaItem[] {
  const vistos = new Set<string>()
  return listas.flat().filter((i) => (vistos.has(i._id) ? false : (vistos.add(i._id), true)))
}

/** Pendientes primero (por prioridad y antigüedad); después el resto en el orden recibido (más recientes). */
function pendientesPrimero(incidencias: readonly IncidenciaListaItem[]): IncidenciaListaItem[] {
  const activas = incidencias.filter((i) => ESTADOS_ACTIVOS.includes(i.estado))
  return [...ordenarBandeja(activas), ...incidencias.filter((i) => !ESTADOS_ACTIVOS.includes(i.estado))]
}

/**
 * Incidencias de una vista. `reportadas` = ids reportados por la persona (GET /incidencias?propias=true),
 * porque el listado no trae el reportante.
 */
export function filtrarVista(
  incidencias: readonly IncidenciaListaItem[],
  vista: VistaBandeja,
  usuarioId: string | null | undefined,
  reportadas: ReadonlySet<string>,
): IncidenciaListaItem[] {
  switch (vista) {
    case 'asignadas': return ordenarBandeja(filtrarBandeja(incidencias, 'mias', usuarioId))
    case 'por_tomar': return ordenarBandeja(filtrarBandeja(incidencias, 'sin_asignar', usuarioId))
    case 'reportadas': return pendientesPrimero(incidencias.filter((i) => reportadas.has(i._id)))
    case 'resueltas': return incidencias.filter((i) => esResueltaPorMi(i, usuarioId))
    default: return pendientesPrimero(incidencias)
  }
}
