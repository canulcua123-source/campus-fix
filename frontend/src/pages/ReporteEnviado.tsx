import { Camera, Check, CheckCircle2, ClipboardList, Copy, ImageUp, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, Spinner } from '../components/ui'
import type { IncidenciaCreada } from '../schemas/incidencia'

export type EstadoFoto = 'sin_foto' | 'subiendo' | 'subida' | 'error'

interface ReporteEnviadoProps {
  creada: IncidenciaCreada
  estadoFoto: EstadoFoto
  errorFoto?: string | null
  onReintentarFoto: () => void
  onContinuarSinFoto: () => void
  /** Limpia el formulario para levantar otro reporte. */
  onReportarOtro?: () => void
}

const SIGUIENTES = [
  'Un técnico del área revisa tu reporte y lo toma.',
  'Verás cada cambio de estado en «Mis reportes».',
  'Cuando quede resuelto, confirma si se solucionó.',
]

/** Paso 3 de Reportar (UX-29): folio (INC-AAAA-MMDD-CAT-NNNN) y estado de la subida de la foto. */
export default function ReporteEnviado({
  creada, estadoFoto, errorFoto, onReintentarFoto, onContinuarSinFoto, onReportarOtro,
}: ReporteEnviadoProps) {
  const [copiado, setCopiado] = useState(false)
  const temporizador = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(temporizador.current), [])

  async function copiarFolio() {
    try {
      await navigator.clipboard.writeText(creada.codigo)
      setCopiado(true)
      window.clearTimeout(temporizador.current)
      temporizador.current = window.setTimeout(() => setCopiado(false), 2000)
    } catch {
      setCopiado(false) // sin permiso de portapapeles: el folio sigue visible y seleccionable
    }
  }

  return (
    <div className="contenido-estrecho mx-auto pila">
      <Card como="section" className="flex flex-col items-center gap-4 text-center" aria-labelledby="reporte-enviado-titulo">
        <span className="grid size-16 place-items-center rounded-full bg-ok text-on-ok" aria-hidden>
          <CheckCircle2 size={34} />
        </span>
        <div>
          <h1 id="reporte-enviado-titulo" className="titulo-pagina !mb-1">Reporte enviado</h1>
          <p className="m-0 text-muted">Tu reporte quedó registrado. Guarda tu folio para darle seguimiento.</p>
        </div>
        <div className="flex w-full flex-col items-center gap-2 rounded-card border border-line bg-panel-2 p-4">
          <p className="m-0 text-sm font-semibold uppercase tracking-wide text-muted">Folio</p>
          <p className="m-0 select-all break-all font-mono text-2xl font-bold text-ink sm:text-3xl">{creada.codigo}</p>
          <Button variante="fantasma" tamano="sm" icono={copiado ? <Check size={16} /> : <Copy size={16} />} onClick={() => void copiarFolio()}>
            {copiado ? 'Folio copiado' : 'Copiar folio'}
          </Button>
          <span className="sr-only" role="status">{copiado ? 'Folio copiado al portapapeles' : ''}</span>
        </div>

        {estadoFoto === 'subiendo' && (
          <p className="m-0 flex items-center gap-2 text-muted" role="status">
            <Spinner tamano={18} etiqueta={null} /> Subiendo la foto como evidencia…
          </p>
        )}
        {estadoFoto === 'subida' && (
          <p className="m-0 flex items-center gap-2 text-sm text-ok" role="status">
            <ImageUp size={18} aria-hidden /> La foto se adjuntó como evidencia.
          </p>
        )}
        {estadoFoto === 'error' && (
          <div role="alert" className="w-full rounded-card border border-warn/40 bg-warn/10 p-4 text-left">
            <p className="m-0 flex items-center gap-2 font-semibold text-warn">
              <TriangleAlert size={18} aria-hidden /> No se pudo adjuntar la foto, reintentar
            </p>
            <p className="mb-0 mt-1 text-sm text-muted">Tu reporte ya está registrado; solo falta la foto.</p>
            {errorFoto && <p className="mb-0 mt-1 text-sm text-muted">{errorFoto}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button icono={<Camera size={18} />} onClick={onReintentarFoto}>Reintentar foto</Button>
              <Button variante="secundario" onClick={onContinuarSinFoto}>Continuar sin foto</Button>
            </div>
          </div>
        )}
      </Card>

      <Card como="section" aria-labelledby="reporte-siguientes">
        <h2 id="reporte-siguientes" className="mb-3 mt-0 text-base font-semibold text-ink">¿Qué sigue?</h2>
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {SIGUIENTES.map((texto, i) => (
            <li key={texto} className="flex items-start gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-panel-2 text-sm font-bold text-brand" aria-hidden>{i + 1}</span>
              <span className="pt-0.5 text-ink">{texto}</span>
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid gap-2 sm:grid-cols-2">
        <Link to={`/incidencias/${encodeURIComponent(creada._id)}`} className="ui-btn ui-btn--primario ui-btn--lg ui-btn--bloque">
          <ClipboardList size={20} aria-hidden /> Ver mi reporte
        </Link>
        {onReportarOtro ? (
          <Button variante="secundario" tamano="lg" bloque icono={<Camera size={20} />} onClick={onReportarOtro}>Reportar otro</Button>
        ) : (
          <Link to="/mis-reportes" className="ui-btn ui-btn--secundario ui-btn--lg ui-btn--bloque">Ir a mis reportes</Link>
        )}
      </div>
      {onReportarOtro && (
        <Link to="/mis-reportes" className="self-center text-sm font-semibold text-brand">Ir a mis reportes</Link>
      )}
    </div>
  )
}
