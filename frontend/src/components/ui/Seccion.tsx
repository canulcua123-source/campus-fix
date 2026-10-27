import clsx from 'clsx'
import { useId, type ReactNode } from 'react'

interface SeccionProps {
  titulo: string
  /** Una línea de contexto bajo el título (no párrafos largos). */
  descripcion?: ReactNode
  /** Botones/enlaces a la derecha del encabezado (usa tamano="sm"). */
  acciones?: ReactNode
  children: ReactNode
  /** Nivel del título (por defecto h2). */
  nivel?: 2 | 3
  /** Quita el padding del cuerpo (para tablas o listas a sangre). */
  sinPadding?: boolean
  como?: 'section' | 'article' | 'div'
  id?: string
  className?: string
}

/** Tarjeta con encabezado (título, descripción, acciones) y cuerpo con padding consistente. */
export function Seccion({
  titulo, descripcion, acciones, children, nivel = 2, sinPadding = false, como: Etiqueta = 'section', id, className,
}: SeccionProps) {
  const idTitulo = useId()
  const Titulo = nivel === 3 ? 'h3' : 'h2'
  return (
    <Etiqueta id={id} className={clsx('ui-seccion', className)} aria-labelledby={idTitulo}>
      <header className="ui-seccion__cabecera">
        <div className="ui-seccion__texto">
          <Titulo id={idTitulo} className="ui-seccion__titulo">{titulo}</Titulo>
          {descripcion && <p className="ui-seccion__descripcion">{descripcion}</p>}
        </div>
        {acciones && <div className="ui-seccion__acciones">{acciones}</div>}
      </header>
      <div className={clsx('ui-seccion__cuerpo', sinPadding && 'ui-seccion__cuerpo--sin-padding')}>{children}</div>
    </Etiqueta>
  )
}
