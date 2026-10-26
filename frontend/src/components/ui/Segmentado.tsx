import type { ReactNode } from 'react'

export interface OpcionSegmentado<T extends string> {
  valor: T
  texto: string
  icono?: ReactNode
}

/** Control segmentado (p. ej. tema claro/oscuro/automático): botones con `aria-pressed` dentro de un grupo. */
export function Segmentado<T extends string>({ etiqueta, valor, opciones, onCambio }: {
  etiqueta: string
  valor: T
  opciones: OpcionSegmentado<T>[]
  onCambio: (v: T) => void
}) {
  return (
    <div role="group" aria-label={etiqueta} className="inline-flex flex-wrap gap-1 rounded-input bg-panel-2 p-1">
      {opciones.map((o) => (
        <button
          key={o.valor}
          type="button"
          aria-pressed={valor === o.valor}
          onClick={() => onCambio(o.valor)}
          className={`inline-flex min-h-11 items-center gap-1.5 rounded-input border-0 px-3 text-sm active:scale-[0.97] ${valor === o.valor ? 'bg-panel font-semibold text-ink shadow-sm' : 'bg-transparent text-muted'}`}
        >
          {o.icono}
          {o.texto}
        </button>
      ))}
    </div>
  )
}
