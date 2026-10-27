import clsx from 'clsx'
import type { LucideIcon } from 'lucide-react'
import { Inbox } from 'lucide-react'
import type { ReactNode } from 'react'

interface EmptyStateProps {
  titulo: string
  descripcion?: string
  icono?: LucideIcon
  /** Siguiente acción: un <Button> o un <Link>. */
  accion?: ReactNode
  /** Variante pequeña para dentro de tarjetas/secciones (ícono chico, sin círculo grande). */
  compacto?: boolean
  /** Nivel del título. Por defecto h2 (h3 si es compacto, porque suele vivir dentro de una Seccion). */
  nivel?: 2 | 3 | 4
}

/** Estado vacío: explica y ofrece la siguiente acción (UX-14). */
export function EmptyState({ titulo, descripcion, icono: Icono = Inbox, accion, compacto = false, nivel }: EmptyStateProps) {
  const Titulo = `h${nivel ?? (compacto ? 3 : 2)}` as 'h2' | 'h3' | 'h4'
  return (
    <div className={clsx('ui-estado', compacto && 'ui-estado--compacto')}>
      <span className="ui-estado__icono"><Icono size={compacto ? 18 : 22} aria-hidden /></span>
      <Titulo className="ui-estado__titulo">{titulo}</Titulo>
      {descripcion && <p className="ui-estado__texto">{descripcion}</p>}
      {accion && <div className="ui-estado__accion">{accion}</div>}
    </div>
  )
}
