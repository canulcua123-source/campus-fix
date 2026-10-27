import clsx from 'clsx'
import type { ReactNode } from 'react'

export interface OpcionSegmentado<T extends string> {
  valor: T
  texto: string
  icono?: ReactNode
}

/** Control segmentado (p. ej. tema claro/oscuro/automático): botones con `aria-pressed` dentro de un grupo. */
export function Segmentado<T extends string>({ etiqueta, valor, opciones, onCambio, tamano = 'md', className }: {
  etiqueta: string
  valor: T
  opciones: OpcionSegmentado<T>[]
  onCambio: (v: T) => void
  /** sm = 36 px por botón en escritorio (44 px táctil), para barras de filtros. */
  tamano?: 'sm' | 'md'
  className?: string
}) {
  return (
    <div role="group" aria-label={etiqueta} className={clsx('ui-segmentado', tamano === 'sm' && 'ui-segmentado--sm', className)}>
      {opciones.map((o) => (
        <button
          key={o.valor}
          type="button"
          aria-pressed={valor === o.valor}
          onClick={() => onCambio(o.valor)}
          className="ui-segmentado__opcion"
        >
          {o.icono}
          {o.texto}
        </button>
      ))}
    </div>
  )
}
