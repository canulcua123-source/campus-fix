import type { TipoBadge } from './Badge'

/** Texto legible de cada valor de enum (UX-12, UX-20). Úsalo también para las <option>. */
export const ETIQUETAS: Record<Exclude<TipoBadge, 'ia'>, Record<string, string>> = {
  estado: { abierta: 'Abierta', en_proceso: 'En proceso', en_espera: 'En espera', resuelta: 'Resuelta', cerrada: 'Cerrada' },
  prioridad: { baja: 'Baja', media: 'Media', alta: 'Alta', critica: 'Crítica' },
  categoria: { computo_redes: 'Cómputo y redes', infraestructura: 'Infraestructura', academico: 'Académico' },
}

/** "en_proceso" → "En proceso" si el valor no está en ETIQUETAS (nunca se muestra el enum crudo). */
export function etiquetaDe(tipo: Exclude<TipoBadge, 'ia'>, valor: string): string {
  const conocida = ETIQUETAS[tipo][valor]
  if (conocida) return conocida
  const texto = valor.replaceAll('_', ' ')
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}
