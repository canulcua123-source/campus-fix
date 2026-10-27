import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Button } from './Button'

interface PanelLateralProps {
  abierto: boolean
  onCerrar: () => void
  titulo: string
  children: ReactNode
  /** Acciones en la cabecera junto a «Cerrar» (p. ej. abrir en página completa). */
  acciones?: ReactNode
}

/**
 * Panel que entra por la derecha en escritorio (560 px) y ocupa la pantalla en móvil.
 * `<dialog>` nativo con showModal(): foco atrapado, Escape y clic en el fondo cierran.
 */
export function PanelLateral({ abierto, onCerrar, titulo, children, acciones }: PanelLateralProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const idTitulo = useId()

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (abierto && !d.open) d.showModal()
    if (!abierto && d.open) d.close()
  }, [abierto])

  return (
    <dialog
      ref={ref}
      className="ui-panel"
      aria-labelledby={idTitulo}
      onClose={onCerrar}
      onClick={(e) => { if (e.target === e.currentTarget) onCerrar() }}
    >
      <div className="ui-panel__cabecera">
        <h2 id={idTitulo} className="ui-panel__titulo">{titulo}</h2>
        <div className="flex items-center gap-1">
          {acciones}
          <Button variante="fantasma" tamano="sm" icono={<X size={20} aria-hidden />} aria-label="Cerrar panel" onClick={onCerrar} />
        </div>
      </div>
      <div className="ui-panel__cuerpo">{abierto && children}</div>
    </dialog>
  )
}
