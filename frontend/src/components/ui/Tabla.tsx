import clsx from 'clsx'
import type { CSSProperties, ReactNode } from 'react'

interface TablaProps {
  /** <thead> y <tbody> normales. Cada <td> lleva `data-label="Columna"` si `apilada`. */
  children: ReactNode
  /** Nombre accesible (caption). Visible solo si `mostrarTitulo`. */
  etiqueta: string
  mostrarTitulo?: boolean
  /** < 640 px: cada fila se vuelve tarjeta con "Columna: valor" (usa data-label en cada td). Si no, scroll horizontal. */
  apilada?: boolean
  /** Filas más bajas (listados largos). */
  densa?: boolean
  /** Alto máximo con scroll vertical y encabezado fijo (p. ej. 480). */
  altoMax?: CSSProperties['maxHeight']
  className?: string
}

/** Tabla con estilo: encabezado fijo, divisores de fila, hover y modo apilado en móvil. Celdas numéricas: `className={claseNumerica}`. */
export function Tabla({ children, etiqueta, mostrarTitulo = false, apilada = false, densa = false, altoMax, className }: TablaProps) {
  return (
    <div
      className={clsx('ui-tabla', apilada && 'ui-tabla--apilada', densa && 'ui-tabla--densa', className)}
      role="region"
      aria-label={etiqueta}
      tabIndex={0}
      style={altoMax !== undefined ? { maxHeight: altoMax } : undefined}
    >
      <table>
        <caption className={mostrarTitulo ? 'ui-tabla__titulo' : 'sr-only'}>{etiqueta}</caption>
        {children}
      </table>
    </div>
  )
}

/** Alinea a la derecha con cifras tabulares (en <th> y <td> de columnas numéricas). */
export const claseNumerica = 'ui-num'
