import clsx from 'clsx'
import type { CSSProperties } from 'react'
import { Card } from './Card'

interface SkeletonProps {
  ancho?: CSSProperties['width']
  alto?: CSSProperties['height']
  redondo?: boolean
  className?: string
}

/** Bloque de carga con la forma del contenido (UX-14). Decorativo: el contenedor anuncia la carga. */
export function Skeleton({ ancho = '100%', alto = 16, redondo = false, className }: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={clsx('ui-skeleton', className)}
      style={{ width: ancho, height: alto, borderRadius: redondo ? 'var(--radius-pill)' : undefined }}
    />
  )
}

/** Lista de tarjetas en carga (forma de "Mis reportes" / "Bandeja"). */
export function SkeletonLista({ filas = 3, etiqueta = 'Cargando…' }: { filas?: number; etiqueta?: string }) {
  return (
    <div role="status" aria-label={etiqueta} className="flex flex-col gap-3">
      {Array.from({ length: filas }, (_, i) => (
        <Card key={i} className="flex gap-3">
          <Skeleton ancho={52} alto={52} />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton ancho="70%" alto={16} />
            <Skeleton ancho="45%" alto={12} />
            <div className="flex gap-2">
              <Skeleton ancho={72} alto={20} redondo />
              <Skeleton ancho={60} alto={20} redondo />
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
