import { CheckCircle2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button, Card, PageHeader } from '../components/ui'
import type { IncidenciaCreada } from '../schemas/incidencia'

export type EstadoFoto = 'sin_foto' | 'subiendo' | 'subida' | 'error'

interface ReporteEnviadoProps {
  creada: IncidenciaCreada
  estadoFoto: EstadoFoto
  errorFoto?: string | null
  onReintentarFoto: () => void
  onContinuarSinFoto: () => void
}

/** Paso 3 de Reportar (UX-29): folio (INC-AAAA-MMDD-CAT-NNNN) y estado de la subida de la foto. */
export default function ReporteEnviado({ creada, estadoFoto, errorFoto, onReintentarFoto, onContinuarSinFoto }: ReporteEnviadoProps) {
  return (
    <>
      <PageHeader titulo="Reporte enviado" />
      <Card como="section" className="flex flex-col gap-3">
        <p className="m-0 flex items-center gap-2 font-semibold text-ok">
          <CheckCircle2 size={22} aria-hidden /> Tu reporte quedó registrado
        </p>
        <div>
          <p className="m-0 text-sm text-muted">Folio</p>
          <p className="m-0 text-2xl font-semibold text-ink">{creada.codigo}</p>
        </div>
        {estadoFoto === 'subiendo' && <p className="m-0 text-muted" role="status">Subiendo la foto como evidencia…</p>}
        {estadoFoto === 'subida' && <p className="m-0 text-sm text-muted" role="status">La foto se adjuntó como evidencia.</p>}
        {estadoFoto === 'error' && (
          <div role="alert">
            <p className="m-0 font-semibold">No se pudo adjuntar la foto, reintentar</p>
            {errorFoto && <p className="mb-0 mt-1 text-sm text-muted">{errorFoto}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={onReintentarFoto}>Reintentar foto</Button>
              <Button variante="secundario" onClick={onContinuarSinFoto}>Continuar sin foto</Button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Link to={`/incidencias/${encodeURIComponent(creada._id)}`} className="ui-btn ui-btn--primario">Ver mi reporte</Link>
          <Link to="/mis-tickets" className="ui-btn ui-btn--secundario">Ir a mis reportes</Link>
        </div>
      </Card>
    </>
  )
}
