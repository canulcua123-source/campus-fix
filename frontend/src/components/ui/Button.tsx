import clsx from 'clsx'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Spinner } from './Spinner'

export type VarianteBoton = 'primario' | 'secundario' | 'peligro' | 'fantasma'
export type TamanoBoton = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBoton
  /** sm = 40 px en escritorio / 44 px táctil (barras de filtros, tablas), md = 44 px (mínimo táctil), lg = 52 px (acción principal). */
  tamano?: TamanoBoton
  /** Muestra spinner, deshabilita el botón y anuncia aria-busy (UX-17). */
  cargando?: boolean
  /** Texto mientras carga, p. ej. "Enviando…". Si no se da, se mantiene el texto. */
  textoCargando?: string
  /** Ícono lucide-react (se marca aria-hidden). */
  icono?: ReactNode
  /** Ocupa todo el ancho. */
  bloque?: boolean
}

/** Botón base. Para botones de solo ícono pasa `aria-label` y deja `children` vacío. */
export function Button({
  variante = 'primario',
  tamano = 'md',
  cargando = false,
  textoCargando,
  icono,
  bloque = false,
  disabled,
  className,
  children,
  type = 'button',
  ...resto
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || cargando}
      aria-busy={cargando || undefined}
      className={clsx(
        'ui-btn',
        `ui-btn--${variante}`,
        tamano !== 'md' && `ui-btn--${tamano}`,
        bloque && 'ui-btn--bloque',
        !children && 'ui-btn--icono',
        className,
      )}
      {...resto}
    >
      {cargando ? <Spinner tamano={18} etiqueta={null} /> : icono && <span aria-hidden className="inline-flex">{icono}</span>}
      {cargando && textoCargando ? textoCargando : children}
    </button>
  )
}
