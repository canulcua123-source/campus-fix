import clsx from 'clsx'
import { Clock, MapPin } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { haceCuanto } from '../lib/tiempo'
import type { IncidenciaListaItem } from '../schemas/incidencia'
import { Badge, Card } from './ui'

interface TarjetaIncidenciaProps {
  incidencia: IncidenciaListaItem
  /** Muestra el técnico asignado (tablero del coordinador). */
  mostrarTecnico?: boolean
  /** Acción en línea bajo la tarjeta (p. ej. "Tomar"); queda fuera del enlace. */
  accion?: ReactNode
  /** Tono del tiempo transcurrido (SLA): atención = ámbar, vencida = rojo. */
  tonoTiempo?: 'normal' | 'atencion' | 'vencida'
}

const TONO_TIEMPO = { normal: 'text-muted', atencion: 'text-warn font-semibold', vencida: 'text-bad font-semibold' } as const

/** Iniciales para el avatar del técnico ("Ana López" → "AL"). */
function iniciales(nombre: string): string {
  return nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')
}

/** Avatar circular con iniciales (decorativo: el nombre siempre va al lado). */
export function AvatarIniciales({ nombre }: { nombre: string }) {
  return (
    <span aria-hidden className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-panel-2 text-xs font-semibold text-ink">
      {iniciales(nombre)}
    </span>
  )
}

function textoUbicacionCorta(u: IncidenciaListaItem['ubicacion']): string {
  return [u.edificio, u.aula].filter(Boolean).join(' · ')
}

/** Tarjeta compacta de incidencia: el título es el enlace y su área táctil cubre toda la tarjeta; borde izquierdo con el color de la prioridad. */
export function TarjetaIncidencia({ incidencia: t, mostrarTecnico = false, accion, tonoTiempo = 'normal' }: TarjetaIncidenciaProps) {
  const ubicacion = textoUbicacionCorta(t.ubicacion)
  return (
    <Card
      className="relative flex flex-col gap-2 transition-colors hover:border-line-strong focus-within:border-line-strong"
      style={{ borderLeft: `4px solid var(--prioridad-${t.prioridad}, var(--color-border))` }}
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium tabular-nums text-muted">{t.codigo}</span>
        <span className={clsx('inline-flex items-center gap-1', TONO_TIEMPO[tonoTiempo])}>
          <Clock size={12} aria-hidden />
          {haceCuanto(t.fecha_creacion)}
        </span>
      </div>
      <Link
        to={`/incidencias/${encodeURIComponent(t._id)}`}
        className="line-clamp-2 font-semibold leading-snug text-ink no-underline after:absolute after:inset-0 after:rounded-card after:content-['']"
      >
        {t.titulo}
      </Link>
      <div className="flex flex-wrap gap-1.5">
        <Badge tipo="estado" valor={t.estado} />
        <Badge tipo="prioridad" valor={t.prioridad} />
        <Badge tipo="categoria" valor={t.categoria} />
      </div>
      {(ubicacion || mostrarTecnico) && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm text-muted">
          {ubicacion && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <MapPin size={14} aria-hidden className="shrink-0" />
              <span className="truncate">{ubicacion}</span>
            </span>
          )}
          {mostrarTecnico && (
            t.tecnico_asignado ? (
              <span className="inline-flex items-center gap-1.5 text-ink">
                <AvatarIniciales nombre={t.tecnico_asignado.nombre} />
                {t.tecnico_asignado.nombre}
              </span>
            ) : <span className="italic">Sin asignar</span>
          )}
        </div>
      )}
      {accion && <div className="relative z-10 mt-1">{accion}</div>}
    </Card>
  )
}
