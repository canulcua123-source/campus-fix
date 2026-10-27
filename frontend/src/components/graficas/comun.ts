import type { CSSProperties } from 'react'

/** Estilos compartidos de las gráficas Recharts: solo tokens (UX-10/UX-13). */
export const ejeTick = { fill: 'var(--color-text-muted)', fontSize: 12 }
export const ejeLinea = { stroke: 'var(--color-border)' }
export const rejilla = 'var(--color-border)'
export const tooltipContenido: CSSProperties = {
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text)',
  borderColor: 'var(--color-border)',
  borderRadius: 'var(--radius-input)',
  fontSize: 13,
}
export const tooltipEtiqueta: CSSProperties = { color: 'var(--color-text)', fontWeight: 600 }
export const cursorBarra = { fill: 'var(--color-surface-2)', opacity: 0.8 }

/** UX-25: sin animaciones de Recharts si el usuario pidió movimiento reducido. */
export function animarGraficas(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
