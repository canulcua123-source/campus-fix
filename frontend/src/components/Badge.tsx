const ETIQUETAS: Record<string, string> = {
  abierta: 'Abierta', en_proceso: 'En proceso', en_espera: 'En espera', resuelta: 'Resuelta', cerrada: 'Cerrada',
  baja: 'Baja', media: 'Media', alta: 'Alta', critica: 'Crítica',
  computo_redes: 'Cómputo y redes', infraestructura: 'Infraestructura', academico: 'Académico',
}

export type TipoBadge = 'estado' | 'prioridad' | 'categoria'

export function Badge({ tipo, valor }: { tipo: TipoBadge; valor: string }) {
  const color = `var(--${tipo === 'categoria' ? 'categoria' : tipo}-${valor.replaceAll('_', '-')})`
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
      style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 35%, transparent)` }}
    >
      {ETIQUETAS[valor] ?? valor}
    </span>
  )
}
