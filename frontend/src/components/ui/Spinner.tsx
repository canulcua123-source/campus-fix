import clsx from 'clsx'

interface SpinnerProps {
  /** Tamaño en px (por defecto 20). */
  tamano?: number
  /** Texto para lectores de pantalla. Si es null, el spinner es decorativo (aria-hidden). */
  etiqueta?: string | null
  className?: string
}

/** Indicador de actividad. Solo dentro de botones o zonas pequeñas: para cargar pantallas usa Skeleton (UX-14). */
export function Spinner({ tamano = 20, etiqueta = 'Cargando', className }: SpinnerProps) {
  const circulo = <span className={clsx('ui-spinner', className)} style={{ width: tamano, height: tamano }} aria-hidden />
  if (etiqueta === null) return circulo
  return (
    <span role="status" className="inline-flex">
      {circulo}
      <span className="sr-only">{etiqueta}</span>
    </span>
  )
}
