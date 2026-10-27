import { Activity, ChevronRight, Clock, RefreshCw, UserCheck, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/store'
import { OperacionTecnico } from '../components/OperacionTecnico'
import { usePanelIncidencia } from '../components/PanelIncidencia'
import { useTecnicos } from '../api/hooks/admin'
import { useCargaTecnicos } from '../api/hooks/analitica'
import { mensajeDeError } from '../api/client'
import { AvatarIniciales } from '../components/TarjetaIncidencia'
import { Button, EmptyState, ErrorState, PageHeader, PanelLateral, Seccion, SkeletonLista, StatGrid, StatTile } from '../components/ui'

type FilaCarga = { id: string; nombre: string; activas: number; horas: number }

const numero = new Intl.NumberFormat('es-MX')
const horasFmt = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 })

/** Técnicos del coordinador ordenados por carga activa (GET /usuarios/tecnicos + GET /analitica/carga-tecnicos). */
export default function Tecnicos() {
  const tecnicos = useTecnicos()
  const carga = useCargaTecnicos()
  const [elegido, setElegido] = useState<FilaCarga | null>(null)
  const { abrir, panel } = usePanelIncidencia()
  const puedeCrearUsuarios = useAuth((s) => s.tiene('usuarios:gestionar'))
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
  const totalActivas = filas.reduce((s, f) => s + f.activas, 0)
  const totalHoras = filas.reduce((s, f) => s + f.horas, 0)
  const disponibles = filas.filter((f) => f.activas === 0).length
  const promedio = filas.length ? totalActivas / filas.length : 0

  return (
    <div className="pila">
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
        <>
          <StatGrid columnas={4} etiqueta="Resumen del equipo">
            <StatTile etiqueta="Técnicos" valor={numero.format(filas.length)} icono={<Users size={18} />} pista={`${numero.format(disponibles)} sin carga`} />
            <StatTile etiqueta="Incidencias activas" valor={numero.format(totalActivas)} icono={<Activity size={18} />} tono="brand" />
            <StatTile etiqueta="Promedio por técnico" valor={horasFmt.format(promedio)} icono={<UserCheck size={18} />} tono={promedio > 5 ? 'warning' : 'neutral'} />
            <StatTile etiqueta="Horas acumuladas" valor={`${horasFmt.format(totalHoras)} h`} icono={<Clock size={18} />} />
          </StatGrid>

          <Seccion titulo="Carga por técnico" descripcion="Ordenados de mayor a menor carga. Toca uno para ver toda su operación." sinPadding>
            <ul className="m-0 flex list-none flex-col p-0" aria-label="Carga por técnico">
              {filas.map((f) => {
                const proporcion = f.activas / maximo
                const tonoBarra = f.activas === 0 ? 'bg-line-strong' : proporcion >= 0.8 && f.activas >= 5 ? 'bg-warn' : 'bg-brand'
                return (
                  <li key={f.id} className="border-t border-line first:border-t-0">
                    <button
                      type="button"
                      onClick={() => setElegido(f)}
                      className="flex min-h-11 w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-4 py-3 text-left text-ink transition-colors hover:bg-panel-2"
                      aria-label={`${f.nombre}: ${f.activas} incidencias activas, ${horasFmt.format(f.horas)} horas. Ver su operación`}
                    >
                      <AvatarIniciales nombre={f.nombre} />
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                          <span className="truncate font-semibold">{f.nombre}</span>
                          <span className="text-sm tabular-nums text-muted">
                            {numero.format(f.activas)} {f.activas === 1 ? 'activa' : 'activas'} · {horasFmt.format(f.horas)} h
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel-2" aria-hidden>
                          <div className={`h-full rounded-full ${tonoBarra}`} style={{ width: `${Math.max(proporcion * 100, f.activas ? 4 : 0)}%` }} />
                        </div>
                      </div>
                      <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden />
                    </button>
                  </li>
                )
              })}
            </ul>
          </Seccion>
        </>
      )}

      <p className="m-0 flex flex-wrap items-center gap-x-2 text-sm text-muted">
        <UserPlus size={16} aria-hidden />
        {puedeCrearUsuarios
          ? <>Para dar de alta un técnico ve a <Link to="/admin/usuarios">Usuarios → Nuevo usuario</Link> y elige el rol Técnico con sus áreas.</>
          : 'Los técnicos los da de alta el administrador en Usuarios. Pídeselo indicando nombre, correo y áreas.'}
      </p>

      <PanelLateral abierto={Boolean(elegido)} onCerrar={() => setElegido(null)} titulo={elegido ? `Operación de ${elegido.nombre}` : 'Operación'}>
        {elegido && <OperacionTecnico tecnicoId={elegido.id} horas={elegido.horas} onAbrirIncidencia={abrir} />}
      </PanelLateral>
      {panel}
    </div>
  )
}
