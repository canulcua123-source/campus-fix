import { Camera, CheckCircle2, Eye, Home, PencilLine, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Adhesion, PosibleDuplicado } from '../schemas/ia'
import { Badge, Button, Card } from './ui'

/** "hace un momento" · "hace 12 min" · "hace 3 h" (la ventana de G8 es de 24 h). */
function haceCuanto(minutos: number): string {
  if (minutos < 1) return 'hace un momento'
  if (minutos < 60) return `hace ${minutos} min`
  return `hace ${Math.floor(minutos / 60)} h`
}

function personasMas(n: number): string {
  if (n === 0) return 'aún nadie más se ha sumado'
  return n === 1 ? '1 persona más ya se sumó' : `${n} personas más ya se sumaron`
}

interface AvisoDuplicadoProps {
  duplicado: PosibleDuplicado
  sumando: boolean
  error?: string | null
  onSumarme: () => void
  onReportarIgual: () => void
}

/** G8 (T-038): la misma falla ya se reportó en esta aula. Solo folio, categoría y tiempo; nunca quién la reportó. */
export function AvisoDuplicado({ duplicado, sumando, error, onSumarme, onReportarIgual }: AvisoDuplicadoProps) {
  return (
    <Card como="section" className="flex flex-col gap-3 border-[var(--color-secondary)]" aria-labelledby="aviso-duplicado-titulo">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-panel-2 text-brand" aria-hidden>
          <Users size={20} />
        </span>
        <div className="min-w-0">
          <h2 id="aviso-duplicado-titulo" className="m-0 text-base font-semibold text-ink">
            Esto ya fue reportado {haceCuanto(duplicado.reportado_hace_minutos)}
          </h2>
          <p className="mb-0 mt-1 text-sm text-muted">
            Alguien ya reportó una falla igual en esta aula y {personasMas(duplicado.adhesiones)}. Si es la misma, súmate: así
            el técnico sabe que afecta a más personas y no se duplica el trabajo.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full border border-line bg-panel px-3 py-1 font-mono font-semibold text-ink">{duplicado.codigo}</span>
        <Badge tipo="categoria" valor={duplicado.categoria} />
      </div>
      {error && <p role="alert" className="m-0 text-sm text-bad">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button icono={<Eye size={18} aria-hidden />} cargando={sumando} textoCargando="Sumándote…" onClick={onSumarme}>
          Yo también lo vi
        </Button>
        <Button variante="secundario" icono={<PencilLine size={18} aria-hidden />} disabled={sumando} onClick={onReportarIgual}>
          Es otra falla, reportar igual
        </Button>
      </div>
    </Card>
  )
}

/** Resultado de "Yo también lo vi": no se crea un reporte nuevo. */
export function AdhesionConfirmada({ adhesion, onReportarOtro }: { adhesion: Adhesion; onReportarOtro: () => void }) {
  const personas = adhesion.adhesiones + 1
  return (
    <div className="contenido-estrecho mx-auto pila">
      <Card como="section" className="flex flex-col items-center gap-4 text-center" aria-labelledby="adhesion-titulo">
        <span className="grid size-16 place-items-center rounded-full bg-ok text-on-ok" aria-hidden>
          <CheckCircle2 size={34} />
        </span>
        <div>
          <h1 id="adhesion-titulo" className="titulo-pagina !mb-1">Te sumaste al reporte {adhesion.codigo}</h1>
          <p role="status" className="m-0 text-muted">
            {adhesion.registrada
              ? `Gracias. Ahora son ${personas} personas que vieron esta falla; el equipo técnico ya la tiene registrada.`
              : 'Ya te habías sumado a este reporte; no es necesario hacerlo de nuevo.'}
          </p>
        </div>
      </Card>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button tamano="lg" bloque icono={<Camera size={20} />} onClick={onReportarOtro}>Reportar otra falla</Button>
        <Link to="/" className="ui-btn ui-btn--secundario ui-btn--lg ui-btn--bloque">
          <Home size={20} aria-hidden /> Ir al inicio
        </Link>
      </div>
    </div>
  )
}
