import { CircleAlert, CircleCheck, X } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'

type Tono = 'neutro' | 'marca' | 'ok' | 'apagado'

const TONOS: Record<Tono, CSSProperties> = {
  neutro: { '--badge-bg': 'var(--color-surface-2)', '--badge-text': 'var(--color-text)' } as CSSProperties,
  marca: { '--badge-bg': 'var(--estado-abierta-bg)', '--badge-text': 'var(--estado-abierta-text)' } as CSSProperties,
  ok: { '--badge-bg': 'var(--estado-resuelta-bg)', '--badge-text': 'var(--estado-resuelta-text)' } as CSSProperties,
  apagado: { '--badge-bg': 'var(--estado-cerrada-bg)', '--badge-text': 'var(--estado-cerrada-text)' } as CSSProperties,
}

/** Insignia libre (rol, alcance, estado de cuenta) con los pares AA de tokens.css; siempre con texto. */
export function Chip({ tono = 'neutro', icono, children }: { tono?: Tono; icono?: ReactNode; children: ReactNode }) {
  return <span className="ui-badge border border-line" style={TONOS[tono]}>{icono}{children}</span>
}

/** Aviso de resultado (éxito = role="status", error = role="alert") que se puede cerrar. */
export function Aviso({ tipo, children, onCerrar }: { tipo: 'ok' | 'error'; children: string; onCerrar: () => void }) {
  const Icono = tipo === 'ok' ? CircleCheck : CircleAlert
  return (
    <div role={tipo === 'ok' ? 'status' : 'alert'} className="flex items-center gap-3 rounded-xl border border-line bg-panel py-1 pl-4 pr-1 text-sm text-ink">
      <Icono size={18} aria-hidden className={tipo === 'ok' ? 'shrink-0 text-ok' : 'shrink-0 text-bad'} />
      <span className="flex-1">{children}</span>
      <button type="button" aria-label="Cerrar aviso" onClick={onCerrar} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted active:scale-[0.97]">
        <X size={18} aria-hidden />
      </button>
    </div>
  )
}

/** Bloque numerado de un formulario por pasos (fieldset + legend). */
export function Paso({ numero, titulo, ayuda, children }: { numero: number; titulo: string; ayuda?: string; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <legend className="float-left flex w-full items-center gap-2 text-base font-semibold text-ink">
        <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs text-on-brand">{numero}</span>
        {titulo}
      </legend>
      {ayuda && <p className="-mt-1 text-sm text-muted">{ayuda}</p>}
      {children}
    </fieldset>
  )
}
