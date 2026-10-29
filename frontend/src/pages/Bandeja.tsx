import {
  Camera, CheckCheck, CircleCheck, ClipboardList, Hand, Hourglass, Inbox, ListFilter, RefreshCw, Search, SearchX, type LucideIcon,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
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
  antiguedad, esMia, esResueltaPorMi, esVistaBandeja, filtrarVista, unirIncidencias, VISTAS_BANDEJA, type VistaBandeja,
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
  todas: { texto: 'Todas', ayuda: 'Tus asignadas, las de tu área sin técnico y las que reportaste.' },
  asignadas: { texto: 'Asignadas a mí', ayuda: 'Pendientes a tu cargo, de la más urgente a la menos urgente.' },
  por_tomar: { texto: 'Por tomar', ayuda: 'Sin técnico asignado en tu área. Tómala para que pase a «Asignadas a mí».' },
  reportadas: { texto: 'Reportadas por mí', ayuda: 'Fallas que tú reportaste y su avance.' },
  resueltas: { texto: 'Resueltas', ayuda: 'Resueltas por ti: esperan que el reportante confirme (7 días).' },
}

/** «Mis incidencias»: pantalla única del técnico, filtrable por vista (?vista=) y estado (?estado=). */
export default function Bandeja() {
  const [params, setParams] = useSearchParams()
  const crudaVista = params.get('vista')
  const vista: VistaBandeja = esVistaBandeja(crudaVista) ? crudaVista : 'todas'
  const crudoEstado = params.get('estado')
  const estado = esEstado(crudoEstado) ? crudoEstado : undefined

  const todas = useIncidencias({})
  // El listado no trae el reportante: «Reportadas por mí» se arma con ?propias=true.
  const propias = useIncidencias({ propias: true })
  const me = useMe()
  const tomar = useTomar()
  const [aviso, setAviso] = useState<string | null>(null)
  const [consulta, setConsulta] = useState('')
  const { abrir, panel } = usePanelIncidencia()
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
      if (cambios.vista === 'todas') siguiente.delete('vista')
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
  const porVista = Object.fromEntries(
    VISTAS_BANDEJA.map((v) => [v, filtrarVista(coincidentes, v, usuarioId, reportadas)]),
  ) as Record<VistaBandeja, IncidenciaListaItem[]>
  const enVista = porVista[vista]
  const visibles = estado ? enVista.filter((t) => t.estado === estado) : enVista

  const opcionesVista: OpcionChip<VistaBandeja>[] = VISTAS_BANDEJA.map((v) => ({
    valor: v, texto: VISTAS[v].texto, cuenta: listo ? porVista[v].length : undefined,
  }))
  const cuentaEstado = (e: Estado) => enVista.filter((t) => t.estado === e).length
  const estadosPresentes = ESTADOS.filter((e) => cuentaEstado(e) > 0 || e === estado)
  const opcionesEstado: OpcionChip<Estado | 'todos'>[] = [
    { valor: 'todos', texto: 'Todos', cuenta: enVista.length },
    ...estadosPresentes.map((e) => ({ valor: e, texto: ETIQUETAS.estado[e], cuenta: cuentaEstado(e) })),
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
          <CircleCheck size={16} aria-hidden /> Aceptada por ti
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
          tomar.mutate(t._id, { onSuccess: () => setAviso(`Tomaste ${t.codigo}. Ya está en «Asignadas a mí».`) })
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
    todas: {
      titulo: 'Todo al día',
      descripcion: 'No tienes incidencias asignadas, no hay pendientes por tomar en tu área y no has reportado fallas.',
      icono: Inbox,
    },
    asignadas: {
      titulo: 'No tienes incidencias asignadas',
      descripcion: nPorTomar > 0
        ? `Hay ${nPorTomar} sin técnico en tu área que puedes tomar.`
        : 'Cuando te asignen una incidencia o tomes una, aparecerá aquí.',
      icono: CircleCheck,
      accion: nPorTomar > 0 ? irA('por_tomar', 'Ver por tomar') : undefined,
    },
    por_tomar: {
      titulo: 'No hay incidencias por tomar',
      descripcion: 'Todas las incidencias de tu área ya tienen técnico asignado.',
      icono: Hourglass,
      accion: nAsignadas > 0 ? irA('asignadas', 'Ver asignadas a mí') : undefined,
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
      accion: nAsignadas > 0 ? irA('asignadas', 'Ver asignadas a mí') : undefined,
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
    if (estado && enVista.length > 0) {
      return (
        <EmptyState
          compacto
          titulo={`Ninguna en estado ${ETIQUETAS.estado[estado]}`}
          descripcion={`En «${VISTAS[vista].texto}» no hay incidencias con ese estado.`}
          icono={ListFilter}
          accion={<Button variante="secundario" tamano="sm" onClick={() => cambiar({ estado: null })}>Ver todos los estados</Button>}
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
        subtitulo="Lo asignado a ti, lo pendiente de tu área y lo que reportaste"
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
        {listo && (estadosPresentes.length > 1 || estado) && (
          <FiltroChips<Estado | 'todos'>
            etiqueta="Filtrar por estado"
            tamano="sm"
            valor={estado ?? 'todos'}
            opciones={opcionesEstado}
            onCambio={(e) => cambiar({ estado: e === 'todos' ? null : e })}
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
