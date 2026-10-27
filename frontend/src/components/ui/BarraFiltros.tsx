import clsx from 'clsx'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'
import { useId, useState, type FormEvent, type ReactNode } from 'react'

interface BarraFiltrosProps {
  /** Campos (Input/Select/RangoFechas con `tamano="sm"`). */
  children: ReactNode
  /** Botones al final de la fila, alineados con la base de los campos (p. ej. Limpiar + Aplicar). */
  acciones?: ReactNode
  /** Nombre accesible del grupo y texto del botón en móvil. */
  etiqueta?: string
  /** Número de filtros activos: se muestra en el botón de móvil ("Filtros · 2"). */
  activos?: number
  /** Si se da, la barra es un <form> y Enter / un botón type="submit" lo llama. */
  onEnviar?: () => void
  /** Abierta al inicio en móvil. */
  abiertaInicial?: boolean
  className?: string
}

/** Barra compacta de filtros: campos en fila adaptable + acciones al final en la misma base; en móvil se pliega tras un botón "Filtros". */
export function BarraFiltros({
  children, acciones, etiqueta = 'Filtros', activos, onEnviar, abiertaInicial = false, className,
}: BarraFiltrosProps) {
  const [abierta, setAbierta] = useState(abiertaInicial)
  const idContenido = useId()
  const contenido = (
    <div id={idContenido} className="ui-filtros__contenido">
      <div className="ui-filtros__campos">{children}</div>
      {acciones && <div className="ui-filtros__acciones">{acciones}</div>}
    </div>
  )
  const props = {
    className: clsx('ui-filtros', className),
    'data-abierta': abierta,
    'aria-label': etiqueta,
  }
  const alternar = (
    <button
      type="button"
      className="ui-btn ui-btn--secundario ui-btn--sm ui-filtros__alternar"
      aria-expanded={abierta}
      aria-controls={idContenido}
      onClick={() => setAbierta((v) => !v)}
    >
      <SlidersHorizontal size={16} aria-hidden />
      {etiqueta}
      {activos ? <span className="ui-filtros__contador">{activos}</span> : null}
      <ChevronDown size={16} aria-hidden className="ui-filtros__chevron" />
    </button>
  )
  if (onEnviar) {
    const enviar = (e: FormEvent) => {
      e.preventDefault()
      onEnviar()
    }
    return <form {...props} onSubmit={enviar}>{alternar}{contenido}</form>
  }
  return <div role="group" {...props}>{alternar}{contenido}</div>
}
