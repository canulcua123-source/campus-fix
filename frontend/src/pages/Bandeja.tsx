import {
  Camera, CheckCheck, CircleCheck, ClipboardList, Hand, Hourglass, ListFilter, RefreshCw, Search, SearchX, type LucideIcon,
} from 'lucide-react'
import { useCallback, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMe } from '../api/hooks/auth'
import { mensajeDeError } from '../api/client'
import { useIncidencias, useTomar } from '../api/hooks/incidencias'
import { useAuth } from '../auth/store'
import { usePanelIncidencia } from '../components/PanelIncidencia'
import { TarjetaIncidencia } from '../components/TarjetaIncidencia'
import {
  Button, EmptyState, ErrorState, ETIQUETAS, FiltroChips, Input, PageHeader, SkeletonLista, type OpcionChip,
} from '../components/ui'
import {
  antiguedad, esMia, esResueltaPorMi, estaEnAlcanceOperativo, esVistaBandeja, filtrarVista, unirIncidencias,
  VISTAS_BANDEJA, type VistaBandeja,
} from '../lib/bandeja'
import { ESTADOS, type Estado, type IncidenciaListaItem } from '../schemas/incidencia'

/** Sin acentos ni mayúsculas, para comparar «aire» con «Aire acondicionado». */
const plegar = (texto: string) => texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Coincide si todas las palabras aparecen en título, folio, edificio o aula. */
function coincide(t: IncidenciaListaItem, consulta: string) {
  const palabras = plegar(consulta).split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return true
  const texto = plegar([t.titulo, t.codigo, t.ubicacion.edificio, t.ubicacion.aula].filter(Boolean).join(' '))
  return palabras.every((p) => texto.includes(p))
}

const esEstado = (valor: string | null): valor is Estado => ESTADOS.includes(valor as Estado)
const ACTIVOS: readonly string[] = ['abierta', 'en_proceso', 'en_espera']

const VISTAS: Record<VistaBandeja, { texto: string; ayuda: string }> = {
  asignadas: { texto: 'Trabajos tomados', ayuda: 'Incidencias a tu cargo, de la más urgente a la menos urgente.' },
  por_tomar: { texto: 'Por tomar', ayuda: 'Sin técnico asignado en tu área. Tómala para que pase a «Trabajos tomados».' },
  reportadas: { texto: 'Reportadas por mí', ayuda: 'Fallas que tú reportaste y su avance.' },
  resueltas: { texto: 'Resueltas', ayuda: 'Resueltas por ti: esperan que el reportante confirme (7 días).' },
}

/** «Mis incidencias»: pantalla única del técnico, filtrable por vista (?vista=) y estado (?estado=). */
export default function Bandeja() {
  const [params, setParams] = useSearchParams()
  const crudaVista = params.get('vista')
  const vista: VistaBandeja = esVistaBandeja(crudaVista) ? crudaVista : 'asignadas'
  const crudoEstado = params.get('estado')
  const estado = esEstado(crudoEstado) ? crudoEstado : undefined

  const todas = useIncidencias({})
  // El listado no trae el reportante: «Reportadas por mí» se arma con ?propias=true.
  const propias = useIncidencias({ propias: true })
  const me = useMe()
  const tomar = useTomar()
  const [aviso, setAviso] = useState<string | null>(null)
  const [consulta, setConsulta] = useState('')
  const moverAlEstadoGuardado = useCallback((estadoNuevo: Estado) => {
    setParams((previos) => {
      const siguientes = new URLSearchParams(previos)
      if (estadoNuevo === 'resuelta') {
        siguientes.set('vista', 'resueltas')
        siguientes.delete('estado')
      } else if (estadoNuevo === 'en_proceso' || estadoNuevo === 'en_espera') {
        siguientes.delete('vista')
        siguientes.set('estado', estadoNuevo)
      }
      return siguientes
    }, { replace: true })
  }, [setParams])
  const { abrir, panel } = usePanelIncidencia({ onSeguimientoGuardado: moverAlEstadoGuardado })
  // Espejo de POST /tomar: solo el rol técnico con permiso de seguimiento puede autoasignarse.
  const puedeTomar = useAuth((s) => s.usuario?.rol === 'tecnico' && s.tiene('seguimiento:registrar'))
  const puedeReportar = useAuth((s) => s.tiene('incidencias:crear'))

  const consultas = [todas, propias, me]
  const isPending = consultas.some((q) => q.isPending)
  const isError = consultas.some((q) => q.isError)
  const isFetching = consultas.some((q) => q.isFetching)
  const actualizar = () => consultas.forEach((q) => void q.refetch())
  const listo = !isPending && !isError

  const cambiar = (cambios: { vista?: VistaBandeja; estado?: Estado | null }) => {
    const siguiente = new URLSearchParams(params)
    if (cambios.vista !== undefined) {
      if (cambios.vista === 'asignadas') siguiente.delete('vista')
      else siguiente.set('vista', cambios.vista)
      siguiente.delete('estado')
    }
    if (cambios.estado !== undefined) {
      if (cambios.estado) siguiente.set('estado', cambios.estado)
      else siguiente.delete('estado')
    }
    setParams(siguiente, { replace: true })
  }

  const usuarioId = me.data?._id
  const reportadas = new Set((propias.data ?? []).map((t) => t._id))
  const coincidentes = unirIncidencias(todas.data ?? [], propias.data ?? []).filter((t) => coincide(t, consulta))
  const enAlcance = (t: IncidenciaListaItem) => estaEnAlcanceOperativo(t, me.data)
  const porVista = Object.fromEntries(
    VISTAS_BANDEJA.map((v) => [v, filtrarVista(coincidentes, v, usuarioId, reportadas, enAlcance)]),
  ) as Record<VistaBandeja, IncidenciaListaItem[]>
  const enVista = porVista[vista]
  const estadoActivo: Estado | undefined = vista === 'asignadas' ? (estado ?? 'abierta') : estado
  const visibles = estadoActivo ? enVista.filter((t) => t.estado === estadoActivo) : enVista

  const opcionesVista: OpcionChip<VistaBandeja>[] = VISTAS_BANDEJA
    .filter((v) => v !== 'por_tomar')
    .map((v) => ({
      valor: v, texto: VISTAS[v].texto, cuenta: listo ? porVista[v].length : undefined,
    }))
  const cuentaEstado = (e: Estado) => enVista.filter((t) => t.estado === e).length
  const estadosBase: readonly Estado[] = vista === 'resueltas' ? ['resuelta'] : (ACTIVOS as readonly Estado[])
  const estadosExtra = ESTADOS.filter((e) => !estadosBase.includes(e) && (cuentaEstado(e) > 0 || e === estadoActivo))
  const estadosAMostrar = [...estadosBase, ...estadosExtra].filter(
    (e) => e !== 'abierta' || vista === 'asignadas',
  )
  const opcionesEstado: OpcionChip<Estado | 'todos'>[] = vista === 'asignadas'
    ? estadosAMostrar.map((e) => ({
        valor: e,
        texto: e === 'abierta' ? 'Tomados' : ETIQUETAS.estado[e],
        cuenta: cuentaEstado(e),
      }))
    : [
        { valor: 'todos', texto: 'Todos', cuenta: enVista.length },
        ...estadosAMostrar.map((e) => ({ valor: e, texto: ETIQUETAS.estado[e], cuenta: cuentaEstado(e) })),
      ]

  const accionDe = (t: IncidenciaListaItem): ReactNode => {
    if (esResueltaPorMi(t, usuarioId)) {
      return (
        <p className="m-0 inline-flex items-center gap-1.5 text-sm font-semibold text-muted">
          <Hourglass size={16} aria-hidden /> Esperando confirmación del reportante
        </p>
      )
    }
    if (!ACTIVOS.includes(t.estado)) return undefined
    if (esMia(t, usuarioId)) {
      return (
        <p className="m-0 inline-flex items-center gap-1.5 text-sm font-semibold text-ok">
          <CircleCheck size={16} aria-hidden /> Tomada por ti
        </p>
      )
    }
    if (t.tecnico_asignado) return undefined
    if (!puedeTomar) {
      return (
        <p className="m-0 inline-flex items-center gap-1.5 text-sm font-semibold text-warn">
          <Hourglass size={16} aria-hidden /> Por aceptar
        </p>
      )
    }
    if (!enAlcance(t)) {
      return (
        <p className="m-0 inline-flex items-center gap-1.5 text-sm font-semibold text-muted">
          <Hourglass size={16} aria-hidden /> Fuera de tu área de atención
        </p>
      )
    }
    return (
      <Button
        bloque
        tamano="sm"
        variante="primario"
        icono={<Hand size={16} />}
        aria-label={`Tomar ${t.codigo}`}
        disabled={tomar.isPending}
        cargando={tomar.isPending && tomar.variables === t._id}
        textoCargando="Tomando…"
        onClick={() => {
          setAviso(null)
          tomar.mutate(t._id, { onSuccess: () => setAviso(`Tomaste ${t.codigo}. Ya está en «Trabajos tomados».`) })
        }}
      >
        Tomar
      </Button>
    )
  }

  const irA = (v: VistaBandeja, texto: string) => (
    <Button variante="secundario" tamano="sm" onClick={() => cambiar({ vista: v })}>{texto}</Button>
  )
  const nPorTomar = porVista.por_tomar.length
  const nAsignadas = porVista.asignadas.length
  const VACIOS: Record<VistaBandeja, { titulo: string; descripcion: string; icono: LucideIcon; accion?: ReactNode }> = {
    asignadas: {
      titulo: 'No tienes trabajos tomados',
      descripcion: nPorTomar > 0
        ? `Hay ${nPorTomar} sin técnico en tu área que puedes tomar.`
        : 'Cuando tomes una incidencia o te asignen una, aparecerá aquí.',
      icono: CircleCheck,
      accion: nPorTomar > 0 ? irA('por_tomar', 'Ver por tomar') : undefined,
    },

    por_tomar: {
      titulo: 'No hay incidencias por tomar',
      descripcion: 'Todas las incidencias de tu área ya tienen técnico asignado.',
      icono: Hourglass,
      accion: nAsignadas > 0 ? irA('asignadas', 'Ver trabajos tomados') : undefined,
    },

    reportadas: {
      titulo: 'No has reportado incidencias',
      descripcion: 'Si encuentras una falla, repórtala con una foto y aquí verás su avance.',
      icono: ClipboardList,
      accion: puedeReportar ? (
        <Link to="/reportar" className="ui-btn ui-btn--primario ui-btn--sm"><Camera size={16} aria-hidden /> Reportar</Link>
      ) : undefined,
    },

    resueltas: {
      titulo: 'Sin resueltas por confirmar',
      descripcion: 'Cuando resuelvas una incidencia, aparecerá aquí hasta que el reportante la confirme.',
      icono: CheckCheck,
      accion: nAsignadas > 0 ? irA('asignadas', 'Ver trabajos tomados') : undefined,
    },

  }

  const vacio = (): ReactNode => {
    if (consulta.trim() !== '' && enVista.length === 0) {
      return (
        <EmptyState
          compacto
          titulo="Sin coincidencias"
          descripcion={`Ninguna incidencia de «${VISTAS[vista].texto}» coincide con «${consulta.trim()}».`}
          icono={SearchX}
          accion={<Button variante="secundario" tamano="sm" onClick={() => setConsulta('')}>Limpiar búsqueda</Button>}
        />
      )
    }
    if (estadoActivo && enVista.length > 0) {
      const etiqueta = vista === 'asignadas' && estadoActivo === 'abierta'
        ? 'Trabajos tomados'
        : ETIQUETAS.estado[estadoActivo]
      const otroEstado = vista === 'asignadas'
        ? (ACTIVOS as readonly Estado[]).find((e) => e !== estadoActivo && cuentaEstado(e) > 0)
        : undefined
      return (
        <EmptyState
          compacto
          titulo={`Ninguna en ${etiqueta}`}
          descripcion={`En «${VISTAS[vista].texto}» no hay incidencias en ese apartado.`}
          icono={ListFilter}
          accion={vista === 'asignadas' && otroEstado ? (
            <Button
              variante="secundario"
              tamano="sm"
              onClick={() => cambiar({ estado: otroEstado === 'abierta' ? null : otroEstado })}
            >
              {otroEstado === 'abierta' ? 'Ver trabajos tomados' : `Ver ${ETIQUETAS.estado[otroEstado]}`}
            </Button>
          ) : (
            <Button variante="secundario" tamano="sm" onClick={() => cambiar({ estado: null })}>Ver todos los estados</Button>
          )}
        />
      )
    }
    const v = VACIOS[vista]
    return <EmptyState compacto titulo={v.titulo} descripcion={v.descripcion} icono={v.icono} accion={v.accion} />
  }

  return (
    <div className="pila">
      <PageHeader
        titulo="Mis incidencias"
        subtitulo="Lo que tomaste, lo pendiente de tu área y lo que reportaste"
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

      <div className="pila pila--sm">
        <FiltroChips<VistaBandeja>
          etiqueta="Mostrar"
          valor={vista}
          opciones={opcionesVista}
          onCambio={(v) => cambiar({ vista: v })}
        />
        {listo && (
          <FiltroChips<Estado | 'todos'>
            etiqueta="Filtrar por estado"
            tamano="sm"
            valor={estadoActivo ?? 'todos'}
            opciones={opcionesEstado}
            onCambio={(e) => cambiar({
              estado: e === 'todos' || (vista === 'asignadas' && e === 'abierta') ? null : e,
            })}
          />
        )}
        <p className="m-0 text-sm text-muted">{VISTAS[vista].ayuda}</p>
      </div>

      <Input
        etiqueta="Buscar en mis incidencias"
        etiquetaOculta
        type="search"
        icono={<Search size={18} />}
        placeholder="Buscar por título, folio, edificio o aula"
        value={consulta}
        onChange={(e) => setConsulta(e.target.value)}
        autoComplete="off"
      />

      {aviso && (
        <p role="status" className="m-0 flex items-center gap-2 rounded-input border border-ok bg-panel p-3 text-sm text-ok">
          <CircleCheck size={18} aria-hidden className="shrink-0" />
          {aviso}
        </p>
      )}
      {tomar.isError && (
        <p role="alert" className="m-0 rounded-input border border-bad bg-panel p-3 text-sm text-bad">
          {mensajeDeError(tomar.error, 'No pudimos asignarte la incidencia. Intenta de nuevo.')}
        </p>
      )}

      {isPending && <SkeletonLista etiqueta="Cargando tus incidencias" />}

      {isError && (
        <ErrorState
          titulo="No pudimos cargar tus incidencias"
          mensaje="Revisa tu conexión e intenta de nuevo."
          onReintentar={actualizar}
          reintentando={isFetching}
        />
      )}

      {listo && visibles.length === 0 && vacio()}

      {listo && visibles.length > 0 && (
        <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 xl:grid-cols-3" aria-label={VISTAS[vista].texto}>
          {visibles.map((t) => (
            <li key={t._id}>
              <TarjetaIncidencia
                incidencia={t}
                onAbrir={abrir}
                mostrarTecnico={Boolean(t.tecnico_asignado) && !esMia(t, usuarioId)}
                tonoTiempo={antiguedad(t.fecha_creacion).nivel}
                ocultarEstado={vista === 'asignadas' && t.estado === 'abierta' && esMia(t, usuarioId)}
                accion={accionDe(t)}
              />
            </li>
          ))}
        </ul>
      )}
      {panel}
    </div>
  )
}
