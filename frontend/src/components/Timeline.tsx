import type { EntradaHistorial, IncidenciaDetalle } from '../schemas/incidencia'
import { autorDe, formatearFecha, formatearHoras, ordenarHistorial } from '../lib/detalle'
import { Badge } from './ui'

interface TimelineProps {
  entradas: readonly EntradaHistorial[]
  usuarioActual?: string | null
  reportante: IncidenciaDetalle['reportante']
  tecnico?: IncidenciaDetalle['tecnico_asignado']
}

export function Timeline({ entradas, usuarioActual, reportante, tecnico }: TimelineProps) {
  const ordenadas = ordenarHistorial(entradas)
  if (ordenadas.length === 0) {
    return <p className="m-0 text-sm text-muted">Sin movimientos registrados.</p>
  }
  return (
    <ol className="m-0 list-none p-0">
      {ordenadas.map((entrada, i) => (
        <li key={`${entrada.fecha}-${i}`} className="relative pb-5 pl-6 last:pb-0">
          {i < ordenadas.length - 1 && (
            <span aria-hidden className="absolute left-[5px] top-5 h-full w-px bg-line" />
          )}
          <span aria-hidden className="absolute left-0 top-1.5 h-3 w-3 rounded-full border-2 border-panel bg-brand" />
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge tipo="estado" valor={entrada.estado_nuevo} />
            <span className="text-xs text-muted">{formatearFecha(entrada.fecha)}</span>
            {entrada.horas > 0 && <span className="text-xs text-muted">· {formatearHoras(entrada.horas)}</span>}
          </div>
          <p className="mb-0 mt-1 text-sm font-semibold text-ink">
            {autorDe(entrada, { usuarioActual, reportante, tecnico })}
          </p>
          <p className="mb-0 mt-1 text-sm text-ink">{entrada.comentario}</p>
        </li>
      ))}
    </ol>
  )
}
