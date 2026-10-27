import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface PageHeaderProps {
  titulo: string
  /** En iOS se muestra arriba del título grande (p. ej. "Hola, Ana"); en Android y escritorio, abajo. */
  subtitulo?: string
  /** Ruta para el botón "Atrás". */
  atras?: { to: string; texto?: string }
  /** Botones a la derecha (usa Button variante fantasma con aria-label). */
  acciones?: ReactNode
}

/** Encabezado de pantalla: título grande 34 px en iOS, 22 px en Android, 26 px en escritorio (vía data-platform). */
export function PageHeader({ titulo, subtitulo, atras, acciones }: PageHeaderProps) {
  return (
    <header className="ui-header">
      {atras && (
        <div className="ui-header__atras">
          <Link to={atras.to} className="ui-btn ui-btn--fantasma">
            <ChevronLeft size={22} aria-hidden />
            {atras.texto ?? 'Atrás'}
          </Link>
        </div>
      )}
      <div className="ui-header__texto">
        <h1 className="titulo-pagina">{titulo}</h1>
        {subtitulo && <p className="ui-header__subtitulo">{subtitulo}</p>}
      </div>
      {acciones && <div className="ui-header__acciones">{acciones}</div>}
    </header>
  )
}
