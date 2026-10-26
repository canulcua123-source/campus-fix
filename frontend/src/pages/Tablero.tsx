import { KanbanSquare, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useIncidencias } from '../api/hooks/incidencias'
import { FiltrosTablero, type FiltrosTableroValor } from '../components/FiltrosTablero'
import { SelectorTecnico } from '../components/SelectorTecnico'
import { Badge, Button, EmptyState, ErrorState, PageHeader, SkeletonLista } from '../components/ui'
import { haceCuanto } from '../lib/tiempo'
import { filtrosIncidenciasSchema, type IncidenciaListaItem } from '../schemas/incidencia'

const CAMPOS = ['estado', 'prioridad', 'edificio', 'tecnico'] as const

/** Lee de la URL solo los filtros válidos (los inválidos se ignoran en vez de mandar un 400). */
function filtrosDeUrl(params: URLSearchParams): FiltrosTableroValor {
  const filtros: Record<string, string> = {}
  for (const campo of CAMPOS) {
    const valor = params.get(campo)
    if (valor && filtrosIncidenciasSchema.shape[campo].safeParse(valor).success) filtros[campo] = valor
  }
  return filtros as FiltrosTableroValor
}

/** Tablero del coordinador (T-054): filtros en la URL y asignación/reasignación de técnico. */
export default function Tablero() {
  const [params, setParams] = useSearchParams()
  const filtros = filtrosDeUrl(params)
  const { data, isPending, isError, isFetching, refetch } = useIncidencias(filtros)
  const [seleccion, setSeleccion] = useState<IncidenciaListaItem | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const cambiar = (campo: keyof FiltrosTableroValor, valor: string | undefined) => {
    const siguiente = new URLSearchParams(params)
    if (valor) siguiente.set(campo, valor)
    else siguiente.delete(campo)
    setParams(siguiente, { replace: true })
  }
  const limpiar = () => {
    const siguiente = new URLSearchParams(params)
    CAMPOS.forEach((c) => siguiente.delete(c))
    setParams(siguiente, { replace: true })
  }

  return (
    <>
      <PageHeader
        titulo="Tablero"
        subtitulo="Incidencias de tu área"
        acciones={(
          <Button
            variante="fantasma"
            aria-label="Actualizar"
            icono={<RefreshCw size={20} />}
            cargando={isFetching && !isPending}
            onClick={() => void refetch()}
          />
        )}
      />

      <FiltrosTablero filtros={filtros} onCambiar={cambiar} onLimpiar={limpiar} />

      {aviso && (
        <p role="status" className="mb-3 rounded-input border border-ok p-3 text-sm text-ok">{aviso}</p>
      )}

      {isPending && <SkeletonLista etiqueta="Cargando tablero" />}

      {isError && (
        <ErrorState
          titulo="No pudimos cargar el tablero"
          mensaje="Revisa tu conexión e intenta de nuevo."
          onReintentar={() => void refetch()}
          reintentando={isFetching}
        />
      )}

      {!isPending && !isError && data.length === 0 && (
        <EmptyState
          titulo="Sin incidencias con estos filtros"
          descripcion="Cambia o limpia los filtros para ver más incidencias."
          icono={KanbanSquare}
          accion={Object.keys(filtros).length > 0 ? <Button variante="secundario" onClick={limpiar}>Limpiar filtros</Button> : undefined}
        />
      )}

      {!isPending && !isError && data.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Incidencias del tablero">
          {data.map((t) => {
            const admiteAsignacion = t.estado !== 'cerrada' && t.estado !== 'retirada'
            return (
              <li key={t._id} className="ui-card grid gap-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] lg:items-center lg:gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>{t.codigo}</span>
                    <span>· {haceCuanto(t.fecha_creacion)}</span>
                  </div>
                  <Link to={`/incidencias/${encodeURIComponent(t._id)}`} className="my-1 inline-flex min-h-11 items-center font-semibold text-ink">
                    {t.titulo}
                  </Link>
                  <div className="flex flex-wrap gap-2">
                    <Badge tipo="estado" valor={t.estado} />
                    <Badge tipo="prioridad" valor={t.prioridad} />
                    <Badge tipo="categoria" valor={t.categoria} />
                  </div>
                </div>
                <div className="text-sm">
                  <div className="text-muted">{[t.ubicacion.edificio, t.ubicacion.aula].filter(Boolean).join(' · ')}</div>
                  <div className="text-ink">{t.tecnico_asignado ? t.tecnico_asignado.nombre : 'Sin asignar'}</div>
                </div>
                {admiteAsignacion && (
                  <Button
                    variante={t.tecnico_asignado ? 'secundario' : 'primario'}
                    aria-label={`${t.tecnico_asignado ? 'Reasignar' : 'Asignar'} ${t.codigo}`}
                    onClick={() => {
                      setAviso(null)
                      setSeleccion(t)
                    }}
                  >
                    {t.tecnico_asignado ? 'Reasignar' : 'Asignar'}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {seleccion && (
        <SelectorTecnico
          key={seleccion._id}
          incidencia={seleccion}
          onCerrar={() => setSeleccion(null)}
          onAsignado={(nombre) => {
            setAviso(`${seleccion.codigo} quedó asignada a ${nombre}. El cambio quedó en la bitácora.`)
            setSeleccion(null)
          }}
        />
      )}
    </>
  )
}
