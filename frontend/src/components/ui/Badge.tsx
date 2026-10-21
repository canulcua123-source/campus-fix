import { Sparkles } from 'lucide-react'
import { ETIQUETAS, etiquetaDe } from './etiquetas'

export type TipoBadge = 'estado' | 'prioridad' | 'categoria' | 'ia'

type BadgeProps =
  | { tipo: Exclude<TipoBadge, 'ia'>; valor: string; confianza?: never }
  | { tipo: 'ia'; valor?: never; /** 0–1; muestra "Sugerido por IA · 87 %". */ confianza?: number }

/** Insignia de estado, prioridad, categoría o IA: siempre texto + par de color AA de tokens.css. */
export function Badge(props: BadgeProps) {
  if (props.tipo === 'ia') {
    const pct = props.confianza !== undefined ? ` · ${Math.round(props.confianza * 100)} %` : ''
    return (
      <span className="ui-badge" style={{ '--badge-bg': 'var(--ia-bg)', '--badge-text': 'var(--ia-text)' } as React.CSSProperties}>
        <Sparkles size={12} aria-hidden />
        Sugerido por IA{pct}
      </span>
    )
  }
  const { tipo, valor } = props
  // Valores desconocidos usan el par neutro (cerrada) para no quedar sin color.
  const token = ETIQUETAS[tipo][valor] ? `--${tipo}-${valor.replaceAll('_', '-')}` : '--estado-cerrada'
  return (
    <span className="ui-badge" style={{ '--badge-bg': `var(${token}-bg)`, '--badge-text': `var(${token}-text)` } as React.CSSProperties}>
      {etiquetaDe(tipo, valor)}
    </span>
  )
}
