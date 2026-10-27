import { usePanelIncidencia } from '../components/PanelIncidencia'
import { CircleCheck, Clock, KanbanSquare, MapPin, RefreshCw, Siren, UserX, Wrench } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { mensajeDeError } from '../api/client'
import { useIncidencias, usePrioridad } from '../api/hooks/incidencias'
import { useAuth } from '../auth/store'
import { FiltrosTablero, type FiltrosTableroValor } from '../components/FiltrosTablero'
import { SelectorTecnico } from '../components/SelectorTecnico'
import { AvatarIniciales } from '../components/TarjetaIncidencia'
import {
  Badge, Button, EmptyState, ErrorState, ETIQUETAS, PageHeader, Seccion, Select, SkeletonLista, StatGrid, StatTile, Tabla,
} from '../components/ui'
import { antiguedad } from '../lib/bandeja'
import { filtrosIncidenciasSchema, PRIORIDADES, type IncidenciaListaItem, type Prioridad } from '../schemas/incidencia'

const CAMPOS = ['estado', 'prioridad', 'edificio', 'tecnico'] as const
const ACTIVOS: readonly string[] = ['abierta', 'en_proceso', 'en_espera']
const TONO_TIEMPO = { normal: 'text-muted', atencion: 'text-warn font-semibold', vencida: 'text-bad font-semibold' } as const

/** Lee de la URL solo los filtros válidos (los inválidos se ignoran en vez de mandar un 400). */
function filtrosDeUrl(params: URLSearchParams): FiltrosTableroValor {
  const filtros: Record<string, string> = {}
  for (const campo of CAMPOS) {
    const valor = params.get(campo)
    if (valor && filtrosIncidenciasSchema.shape[campo].safeParse(valor).success) filtros[campo] = valor
  }
  return filtros as FiltrosTableroValor
}

/** Prioridad editable en la fila (coordinador); la API valida permiso, alcance y estado. */
function CeldaPrioridad({ incidencia: t }: { incidencia: IncidenciaListaItem }) {
  const mutacion = usePrioridad(t._id)
  return (
    <div className="flex flex-col gap-1">
      <Select
        tamano="sm"
        etiquetaOculta
        etiqueta={`Prioridad de ${t.codigo}`}
        value={mutacion.isPending ? mutacion.variables.prioridad : t.prioridad}
        disabled={mutacion.isPending}
        aria-busy={mutacion.isPending || undefined}
        opciones={PRIORIDADES.map((p) => ({ valor: p, texto: ETIQUETAS.prioridad[p] }))}
        onChange={(e) => mutacion.mutate({ prioridad: e.target.value as Prioridad })}
        style={{ borderLeft: `4px solid var(--prioridad-${t.prioridad})` }}
      />
      {mutacion.isError && (
        <span role="alert" className="text-xs text-bad">{mensajeDeError(mutacion.error, 'No se pudo cambiar.')}</span>
      )}
    </div>
  )
}

/** Tablero del coordinador (T-054): resumen, filtros en la URL, tabla densa con asignación y prioridad en línea. */
export default function Tablero() {
  const { abrir, panel } = usePanelIncidencia()
  const [params, setParams] = useSearchParams()
  const filtros = filtrosDeUrl(params)
  const { data, isPending, isError, isFetching, refetch } = useIncidencias(filtros)
  const [seleccion, setSeleccion] = useState<IncidenciaListaItem | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const puedePriorizar = useAuth((s) => s.tiene('incidencias:asignar'))

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

  const activas = (data ?? []).filter((t) => ACTIVOS.includes(t.estado))
  const resumen = {
    sinAsignar: activas.filter((t) => !t.tecnico_asignado).length,
    criticas: activas.filter((t) => t.prioridad === 'critica').length,
    enProceso: activas.filter((t) => t.estado === 'en_proceso').length,
    resueltas: (data ?? []).filter((t) => t.estado === 'resuelta').length,
  }

  return (
    <div className="pila">
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

      {!isError && (
        <StatGrid columnas={4} etiqueta="Resumen del tablero">
          <StatTile etiqueta="Sin asignar" valor={resumen.sinAsignar} icono={<UserX size={18} />} tono={resumen.sinAsignar ? 'warning' : 'neutral'} cargando={isPending} />
          <StatTile etiqueta="Críticas activas" valor={resumen.criticas} icono={<Siren size={18} />} tono={resumen.criticas ? 'danger' : 'neutral'} cargando={isPending} />
          <StatTile etiqueta="En proceso" valor={resumen.enProceso} icono={<Wrench size={18} />} tono="brand" cargando={isPending} />
          <StatTile etiqueta="Por confirmar" valor={resumen.resueltas} icono={<CircleCheck size={18} />} tono="success" cargando={isPending} />
        </StatGrid>
      )}

      <FiltrosTablero filtros={filtros} onCambiar={cambiar} onLimpiar={limpiar} edificiosExtra={(data ?? []).map((t) => t.ubicacion.edificio)} />

      {aviso && (
        <p role="status" className="m-0 flex items-center gap-2 rounded-input border border-ok bg-panel p-3 text-sm text-ok">
          <CircleCheck size={18} aria-hidden className="shrink-0" />
          {aviso}
        </p>
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
        <Seccion
          titulo="Incidencias"
          descripcion={`${data.length} ${data.length === 1 ? 'resultado' : 'resultados'}`}
          sinPadding
        >
          <Tabla etiqueta="Incidencias del tablero" apilada densa className="ui-tabla--apilada-md">
            <thead>
              <tr>
                <th scope="col">Incidencia</th>
                <th scope="col">Estado</th>
                <th scope="col">Prioridad</th>
                <th scope="col">Ubicación</th>
                <th scope="col">Técnico</th>
                <th scope="col"><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {data.map((t) => {
                const admiteCambios = t.estado !== 'cerrada' && t.estado !== 'retirada'
                const sla = antiguedad(t.fecha_creacion)
                return (
                  <tr key={t._id}>
                    <td data-label="Incidencia">
                      <div className="flex min-w-0 flex-col">
                        <Link to={`/incidencias/${encodeURIComponent(t._id)}`} onClick={(e) => {
                          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                          e.preventDefault()
                          abrir(t._id)
                        }} className="line-clamp-2 font-semibold text-ink max-lg:py-3">
                          {t.titulo}
                        </Link>
                        <span className="flex flex-wrap items-center gap-x-2 text-xs">
                          <span className="tabular-nums text-muted">{t.codigo}</span>
                          <span className={`inline-flex items-center gap-1 ${TONO_TIEMPO[admiteCambios ? sla.nivel : 'normal']}`}>
                            <Clock size={12} aria-hidden />{sla.texto}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td data-label="Estado"><Badge tipo="estado" valor={t.estado} /></td>
                    <td data-label="Prioridad">
                      {puedePriorizar && admiteCambios ? <CeldaPrioridad incidencia={t} /> : <Badge tipo="prioridad" valor={t.prioridad} />}
                    </td>
                    <td data-label="Ubicación">
                      <span className="inline-flex items-center gap-1 text-sm text-muted">
                        <MapPin size={14} aria-hidden className="shrink-0" />
                        {[t.ubicacion.edificio, t.ubicacion.aula].filter(Boolean).join(' · ')}
                      </span>
                    </td>
                    <td data-label="Técnico">
                      {t.tecnico_asignado ? (
                        <span className="inline-flex items-center gap-1.5 text-sm text-ink">
                          <AvatarIniciales nombre={t.tecnico_asignado.nombre} />
                          {t.tecnico_asignado.nombre}
                        </span>
                      ) : <span className="text-sm italic text-muted">Sin asignar</span>}
                    </td>
                    <td data-label="Acciones">
                      {admiteCambios && (
                        <Button
                          tamano="sm"
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
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </Tabla>
        </Seccion>
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
      {panel}
    </div>
  )
}
