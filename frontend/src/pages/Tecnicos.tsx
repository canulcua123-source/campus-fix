import { ChevronRight, RefreshCw, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTecnicos } from '../api/hooks/admin'
import { useCargaTecnicos } from '../api/hooks/analitica'
import { mensajeDeError } from '../api/client'
import { Button, EmptyState, ErrorState, PageHeader, SkeletonLista, claseCardInteractiva } from '../components/ui'

type FilaCarga = { id: string; nombre: string; activas: number; horas: number }

const numero = new Intl.NumberFormat('es-MX')
const horasFmt = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 })

/** Técnicos del coordinador ordenados por carga activa (GET /usuarios/tecnicos + GET /analitica/carga-tecnicos). */
export default function Tecnicos() {
  const tecnicos = useTecnicos()
  const carga = useCargaTecnicos()
  const isPending = tecnicos.isPending || carga.isPending
  const error = tecnicos.error ?? carga.error
  const isFetching = tecnicos.isFetching || carga.isFetching
  const reintentar = () => {
    if (tecnicos.isError) void tecnicos.refetch()
    if (carga.isError) void carga.refetch()
  }
  const actualizar = () => {
    void tecnicos.refetch()
    void carga.refetch()
  }

  let filas: FilaCarga[] = []
  if (tecnicos.isSuccess && carga.isSuccess) {
    const porId = new Map(carga.data.map((c) => [c.tecnico_id, c]))
    filas = tecnicos.data.map((t) => ({
      id: t._id,
      nombre: t.nombre,
      activas: porId.get(t._id)?.incidencias_activas ?? 0,
      horas: porId.get(t._id)?.horas_acumuladas ?? 0,
    }))
    filas.sort((a, b) => b.activas - a.activas || b.horas - a.horas || a.nombre.localeCompare(b.nombre, 'es'))
  }
  const maximo = Math.max(1, ...filas.map((f) => f.activas))

  return (
    <>
      <PageHeader
        titulo="Técnicos"
        subtitulo="Carga de trabajo activa de tu equipo"
        acciones={(
          <Button
            variante="fantasma"
            aria-label="Actualizar"
            icono={<RefreshCw size={20} />}
            cargando={isFetching && !isPending}
            onClick={actualizar}
          />
        )}
      />

      {isPending && !error && <SkeletonLista etiqueta="Cargando técnicos" />}

      {error && (
        <ErrorState
          titulo="No pudimos cargar a los técnicos"
          mensaje={mensajeDeError(error, 'Revisa tu conexión e intenta de nuevo.')}
          onReintentar={reintentar}
          reintentando={isFetching}
        />
      )}

      {!isPending && !error && filas.length === 0 && (
        <EmptyState
          titulo="Aún no hay técnicos en tu alcance"
          descripcion="Cuando haya técnicos activos en tu área aparecerán aquí con su carga de trabajo."
          icono={Users}
          accion={<Link to="/tablero" className="ui-btn ui-btn--secundario">Ir al tablero</Link>}
        />
      )}

      {!isPending && !error && filas.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Carga por técnico">
          {filas.map((f) => (
            <li key={f.id}>
              <Link
                to={`/tablero?tecnico=${encodeURIComponent(f.id)}`}
                className={`${claseCardInteractiva} flex min-h-11 items-center gap-3 text-ink`}
                aria-label={`${f.nombre}: ${f.activas} incidencias activas, ${horasFmt.format(f.horas)} horas. Ver en el tablero`}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold">{f.nombre}</span>
                    <span className="text-sm text-muted">
                      {numero.format(f.activas)} {f.activas === 1 ? 'activa' : 'activas'} · {horasFmt.format(f.horas)} h
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-panel-2" aria-hidden>
                    <div className="h-full rounded-full bg-brand" style={{ width: `${(f.activas / maximo) * 100}%` }} />
                  </div>
                </div>
                <ChevronRight size={20} className="shrink-0 text-muted" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
