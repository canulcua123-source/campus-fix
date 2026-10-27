import clsx from 'clsx'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import { Button } from './Button'

interface ErrorStateProps {
  titulo?: string
  /** Mensaje en español según el código de error (FRONT-BACK FB-07). */
  mensaje?: string
  /** Normalmente `() => query.refetch()`. */
  onReintentar?: () => void
  reintentando?: boolean
  /** Variante pequeña para dentro de tarjetas/secciones. */
  compacto?: boolean
}

/** Estado de error con botón "Reintentar" (UX-14). Se anuncia con role="alert". */
export function ErrorState({
  titulo = 'No pudimos cargar la información',
  mensaje = 'Revisa tu conexión e inténtalo de nuevo.',
  onReintentar,
  reintentando = false,
  compacto = false,
}: ErrorStateProps) {
  return (
    <div role="alert" className={clsx('ui-estado ui-estado--error', compacto && 'ui-estado--compacto')}>
      <span className="ui-estado__icono"><TriangleAlert size={compacto ? 18 : 22} aria-hidden /></span>
      {compacto ? <h3 className="ui-estado__titulo">{titulo}</h3> : <h2 className="ui-estado__titulo">{titulo}</h2>}
      <p className="ui-estado__texto">{mensaje}</p>
      {onReintentar && (
        <Button variante="secundario" tamano={compacto ? 'sm' : 'md'} icono={<RefreshCw size={18} />} cargando={reintentando} textoCargando="Reintentando…" onClick={onReintentar}>
          Reintentar
        </Button>
      )}
    </div>
  )
}
