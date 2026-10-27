import clsx from 'clsx'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Skeleton } from './Skeleton'

export type TonoStat = 'neutral' | 'brand' | 'success' | 'warning' | 'danger'

interface StatTileProps {
  /** Qué mide, corto: "Abiertas", "Tiempo medio". */
  etiqueta: string
  /** Valor ya formateado: "128", "4.2 h", "87 %". */
  valor: ReactNode
  /** Ícono lucide-react (decorativo), se pinta con el tono. */
  icono?: ReactNode
  tono?: TonoStat
  /** Variación respecto al periodo anterior: texto + dirección; `bueno` decide el color (verde/rojo). */
  delta?: { texto: string; direccion?: 'sube' | 'baja'; bueno?: boolean }
  /** Nota corta bajo el valor ("de 340 en total"). */
  pista?: ReactNode
  /** Muestra skeleton en lugar del valor. */
  cargando?: boolean
}

/** Indicador (KPI) compacto: etiqueta, valor grande, delta/pista opcional e ícono con tono de tokens. */
export function StatTile({ etiqueta, valor, icono, tono = 'neutral', delta, pista, cargando = false }: StatTileProps) {
  const Flecha = delta?.direccion === 'baja' ? ArrowDownRight : ArrowUpRight
  return (
    <div className={clsx('ui-stat', `ui-stat--${tono}`)}>
      <div className="ui-stat__cabecera">
        <p className="ui-stat__etiqueta">{etiqueta}</p>
        {icono && <span className="ui-stat__icono" aria-hidden>{icono}</span>}
      </div>
      {cargando ? <Skeleton ancho="50%" alto={28} /> : <p className="ui-stat__valor">{valor}</p>}
      {(delta || pista) && !cargando && (
        <p className="ui-stat__pie">
          {delta && (
            <span className={clsx('ui-stat__delta', delta.bueno === true && 'ui-stat__delta--bueno', delta.bueno === false && 'ui-stat__delta--malo')}>
              {delta.direccion && <Flecha size={14} aria-hidden />}
              {delta.texto}
            </span>
          )}
          {pista && <span className="ui-stat__pista">{pista}</span>}
        </p>
      )}
    </div>
  )
}

/** Rejilla de StatTile: se adapta sola (mín. 160 px por tile) o fija `columnas` desde 1024 px. */
export function StatGrid({ children, columnas, etiqueta, className }: {
  children: ReactNode
  columnas?: 2 | 3 | 4 | 5 | 6
  /** Nombre accesible del grupo de indicadores. */
  etiqueta?: string
  className?: string
}) {
  return (
    <div
      role={etiqueta ? 'group' : undefined}
      aria-label={etiqueta}
      className={clsx('ui-stat-grid', className)}
      data-columnas={columnas}
    >
      {children}
    </div>
  )
}
