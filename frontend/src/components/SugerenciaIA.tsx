import { AlertTriangle, Sparkles } from 'lucide-react'
import type { AnalisisImagen } from '../schemas/ia'

export function EtiquetaSugerida({ confianza }: { confianza?: number }) {
  return (
    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-panel-2 px-2 py-0.5 text-xs font-semibold text-brand">
      <Sparkles size={12} aria-hidden /> Sugerido por IA{confianza === undefined ? '' : ` · ${Math.round(confianza * 100)} %`}
    </span>
  )
}

interface Props {
  analizando: boolean
  sugerencia: AnalisisImagen | null
  error: string | null
  criticaPendiente: boolean
  camposAceptados: string[]
  camposEditados: string[]
  onConfirmarCritica: () => void
  onDescartarCritica: () => void
}

export function SugerenciaIA({
  analizando, sugerencia, error, criticaPendiente, camposAceptados, camposEditados,
  onConfirmarCritica, onDescartarCritica,
}: Props) {
  if (!analizando && !sugerencia && !error) return null

  return (
    <section aria-live="polite" className="mb-3 flex flex-col gap-2">
      {analizando && (
        <div className="card text-sm" role="status">
          <span className="inline-flex items-center gap-2 font-semibold text-brand">
            <Sparkles size={16} aria-hidden /> La IA está analizando la foto
          </span>
          <p className="mb-0 mt-1 text-muted">Puedes empezar a llenar el formulario mientras termina.</p>
          <div className="mt-2 flex flex-col gap-2" aria-hidden>
            <div className="h-3 w-2/3 animate-pulse rounded bg-panel-2" />
            <div className="h-3 w-full animate-pulse rounded bg-panel-2" />
          </div>
        </div>
      )}

      {error && (
        <div className="card text-sm" role="alert">
          <p className="m-0 font-semibold">No se pudo analizar la foto con IA</p>
          <p className="mb-0 mt-1 text-muted">{error} El formulario manual sigue disponible.</p>
        </div>
      )}

      {sugerencia && !sugerencia.es_incidencia_valida && (
        <div className="card text-sm" role="status">
          La IA no reconoció una incidencia en la foto. Completa el formulario manualmente.
        </div>
      )}

      {sugerencia?.es_incidencia_valida && (
        <div className="card text-sm">
          <span className="inline-flex items-center gap-1 font-semibold text-brand">
            <Sparkles size={16} aria-hidden /> Sugerencia de IA
          </span>
          <span className="ml-2 text-muted">confianza {Math.round(sugerencia.confianza * 100)}%</span>
          <p className="mb-0 mt-1 text-muted">
            {camposAceptados.length} campos aceptados · {camposEditados.length} ajustados por ti
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {sugerencia.campos_detectados.map((c) => (
              <span key={c.nombre} className="rounded-full border border-line bg-panel px-3 py-1 text-xs">
                {c.nombre}: {c.valor}
              </span>
            ))}
          </div>
        </div>
      )}

      {criticaPendiente && (
        <div className="card text-sm" role="alert">
          <span className="inline-flex items-center gap-2 font-semibold">
            <AlertTriangle size={16} aria-hidden /> La IA sugiere prioridad crítica
          </span>
          <p className="mb-2 mt-1 text-muted">
            Crítica se reserva para riesgos de seguridad o servicios caídos. Confírmalo antes de continuar.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn" onClick={onConfirmarCritica}>Sí, es crítica</button>
            <button type="button" className="btn btn-secundario" onClick={onDescartarCritica}>No, mantener</button>
          </div>
        </div>
      )}
    </section>
  )
}
