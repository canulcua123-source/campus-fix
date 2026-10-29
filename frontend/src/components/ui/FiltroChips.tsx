import clsx from 'clsx'
import { useRef, type KeyboardEvent, type ReactNode } from 'react'

export interface OpcionChip<T extends string> {
  valor: T
  texto: string
  /** Cantidad que se muestra en la pastilla; sin número si se omite. */
  cuenta?: number
  icono?: ReactNode
}

/**
 * Fila de filtros tipo chip con contador (una sola opción activa). En móvil se desplaza en horizontal.
 * Accesible como `radiogroup`: Tab entra al chip activo y las flechas, Inicio y Fin cambian la selección.
 */
export function FiltroChips<T extends string>({ etiqueta, valor, opciones, onCambio, tamano = 'md', className }: {
  etiqueta: string
  valor: T
  opciones: OpcionChip<T>[]
  onCambio: (v: T) => void
  /** sm = secundario (36 px en escritorio, 44 px táctil). */
  tamano?: 'sm' | 'md'
  className?: string
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const activo = Math.max(0, opciones.findIndex((o) => o.valor === valor))

  const mover = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const ultimo = opciones.length - 1
    const destino = {
      ArrowRight: i === ultimo ? 0 : i + 1,
      ArrowDown: i === ultimo ? 0 : i + 1,
      ArrowLeft: i === 0 ? ultimo : i - 1,
      ArrowUp: i === 0 ? ultimo : i - 1,
      Home: 0,
      End: ultimo,
    }[e.key]
    if (destino === undefined) return
    e.preventDefault()
    onCambio(opciones[destino].valor)
    refs.current[destino]?.focus()
  }

  return (
    <div className={clsx('ui-chips', tamano === 'sm' && 'ui-chips--sm', className)}>
      <div role="radiogroup" aria-label={etiqueta} className="ui-chips__fila">
        {opciones.map((o, i) => {
          const marcado = i === activo
          return (
            <button
              key={o.valor}
              ref={(el) => { refs.current[i] = el }}
              type="button"
              role="radio"
              aria-checked={marcado}
              tabIndex={marcado ? 0 : -1}
              onClick={() => onCambio(o.valor)}
              onKeyDown={(e) => mover(e, i)}
              className="ui-chip"
            >
              {o.icono}
              <span>{o.texto}</span>
              {o.cuenta !== undefined && (
                <span className="ui-chip__cuenta">
                  <span className="sr-only">: </span>{o.cuenta}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
