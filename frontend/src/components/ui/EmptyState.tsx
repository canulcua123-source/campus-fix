import type { LucideIcon } from 'lucide-react'
import { Inbox } from 'lucide-react'
import type { ReactNode } from 'react'

interface EmptyStateProps {
  titulo: string
  descripcion?: string
  icono?: LucideIcon
  /** Siguiente acción: un <Button> o un <Link>. */
  accion?: ReactNode
}

/** Estado vacío: explica y ofrece la siguiente acción (UX-14). */
export function EmptyState({ titulo, descripcion, icono: Icono = Inbox, accion }: EmptyStateProps) {
  return (
    <div className="ui-estado">
      <span className="ui-estado__icono"><Icono size={26} aria-hidden /></span>
      <h2 className="ui-estado__titulo">{titulo}</h2>
      {descripcion && <p className="ui-estado__texto">{descripcion}</p>}
      {accion}
    </div>
  )
}
