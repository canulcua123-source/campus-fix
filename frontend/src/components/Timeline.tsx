import type { LucideIcon } from 'lucide-react'
import { CircleCheck, CircleDot, Clock, Flag, Lock, CirclePause, UserCheck, Wrench, CircleX } from 'lucide-react'
import type { EntradaHistorial, IncidenciaDetalle } from '../schemas/incidencia'
import { autorDe, formatearFecha, formatearHoras, ordenarHistorial } from '../lib/detalle'
import { haceCuanto } from '../lib/tiempo'
import { Badge } from './ui'

interface TimelineProps {
  entradas: readonly EntradaHistorial[]
  usuarioActual?: string | null
  reportante: IncidenciaDetalle['reportante']
  tecnico?: IncidenciaDetalle['tecnico_asignado']
}

const ICONO_ESTADO: Record<EntradaHistorial['estado_nuevo'], LucideIcon> = {
  abierta: CircleDot,
  en_proceso: Wrench,
  en_espera: CirclePause,
  resuelta: CircleCheck,
  cerrada: Lock,
  retirada: CircleX,
}

function iconoDe(entrada: EntradaHistorial): { Icono: LucideIcon; token: string } {
  if (entrada.tipo === 'asignacion') return { Icono: UserCheck, token: '--color-primary' }
  if (entrada.tipo === 'prioridad') return { Icono: Flag, token: '--prioridad-alta' }
  return { Icono: ICONO_ESTADO[entrada.estado_nuevo] ?? CircleDot, token: `--estado-${entrada.estado_nuevo.replaceAll('_', '-')}` }
}

/** Bitácora cronológica: ícono por tipo de evento, autor, fecha relativa + absoluta, horas y comentario. */
export function Timeline({ entradas, usuarioActual, reportante, tecnico }: TimelineProps) {
  const ordenadas = ordenarHistorial(entradas)
  if (ordenadas.length === 0) {
    return <p className="m-0 text-sm text-muted">Sin movimientos registrados.</p>
  }
  return (
    <ol className="m-0 list-none p-0">
      {ordenadas.map((entrada, i) => {
        const { Icono, token } = iconoDe(entrada)
        return (
          <li key={`${entrada.fecha}-${i}`} className="relative pb-5 pl-11 last:pb-0">
            {i < ordenadas.length - 1 && (
              <span aria-hidden className="absolute bottom-0 left-[15px] top-8 w-px bg-line" />
            )}
            <span
              aria-hidden
              className="absolute left-0 top-0 inline-flex h-8 w-8 items-center justify-center rounded-full border border-line bg-panel"
              style={{ color: `var(${token})` }}
            >
              <Icono size={16} />
            </span>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-semibold text-ink">{autorDe(entrada, { usuarioActual, reportante, tecnico })}</span>
              <Badge tipo="estado" valor={entrada.estado_nuevo} />
            </div>
            <p className="m-0 mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
              <time dateTime={entrada.fecha} title={formatearFecha(entrada.fecha)}>
                {haceCuanto(entrada.fecha)} · {formatearFecha(entrada.fecha)}
              </time>
              {entrada.horas > 0 && (
                <span className="inline-flex items-center gap-1"><Clock size={12} aria-hidden />{formatearHoras(entrada.horas)}</span>
              )}
            </p>
            {entrada.comentario && (
              <p className="mb-0 mt-1.5 whitespace-pre-line rounded-input bg-panel-2 px-3 py-2 text-sm text-ink">{entrada.comentario}</p>
            )}
          </li>
        )
      })}
    </ol>
  )
}
