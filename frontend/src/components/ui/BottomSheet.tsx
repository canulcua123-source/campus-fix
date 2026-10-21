import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Button } from './Button'

interface BottomSheetProps {
  abierto: boolean
  onCerrar: () => void
  titulo: string
  children: ReactNode
  /** Botones al pie (en móvil se apilan con la acción principal abajo). */
  acciones?: ReactNode
}

/**
 * Hoja inferior en móvil y diálogo centrado en escritorio (UX-09).
 * Usa <dialog> nativo con showModal(): foco atrapado, Escape cierra, fondo inerte y aria-modal.
 */
export function BottomSheet({ abierto, onCerrar, titulo, children, acciones }: BottomSheetProps) {
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
      className="ui-sheet"
      aria-labelledby={idTitulo}
      onClose={onCerrar}
      onClick={(e) => {
        // Clic en el fondo (fuera del contenido) cierra.
        if (e.target === e.currentTarget) onCerrar()
      }}
    >
      <div className="ui-sheet__contenido">
      <div className="ui-sheet__asa" aria-hidden />
      <div className="ui-sheet__cabecera">
        <h2 id={idTitulo} className="ui-sheet__titulo">{titulo}</h2>
        <Button variante="fantasma" aria-label="Cerrar" onClick={onCerrar} icono={<X size={22} />} />
      </div>
      {children}
      {acciones && <div className="ui-sheet__acciones">{acciones}</div>}
      </div>
    </dialog>
  )
}
