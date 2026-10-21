import clsx from 'clsx'
import type { HTMLAttributes } from 'react'

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Etiqueta HTML (section, article, li…). Por defecto div. */
  como?: 'div' | 'section' | 'article' | 'li'
}

/** Superficie base (fondo surface, borde y radio de tarjeta). Para tarjetas que navegan, usa
 * `<Link className={claseCardInteractiva}>` y así el foco y el rol de enlace son reales. */
export function Card({ como: Etiqueta = 'div', className, ...resto }: CardProps) {
  return <Etiqueta className={clsx('ui-card', className)} {...resto} />
}

export const claseCardInteractiva = 'ui-card ui-card--interactiva'
