import { Camera, ClipboardList, RefreshCw } from 'lucide-react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useIncidencias } from '../api/hooks/incidencias'
import { useAuth } from '../auth/store'
import { perfilDe } from '../components/navegacion'
import { usePanelIncidencia } from '../components/PanelIncidencia'
import { TarjetaIncidencia } from '../components/TarjetaIncidencia'
import { Button, EmptyState, ErrorState, ETIQUETAS, FiltroChips, PageHeader, SkeletonLista, type OpcionChip } from '../components/ui'
import { ESTADOS, type Estado } from '../schemas/incidencia'

const esEstado = (valor: string | null): valor is Estado => ESTADOS.includes(valor as Estado)

type Filtro = Estado | 'todos'
/** Filtros principales del reportante; otro estado llegado por URL (?estado=en_espera) se agrega como opción. */
const FILTROS: { valor: Filtro; texto: string }[] = [
  { valor: 'todos', texto: 'Todos' },
  { valor: 'abierta', texto: 'Abiertas' },
  { valor: 'en_proceso', texto: 'En proceso' },
  { valor: 'resuelta', texto: 'Resueltas' },
]

/** El técnico ve sus reportes en «Mis incidencias» (pantalla única); el resto, «Mis reportes». */
export default function MisTickets() {
  const esTecnico = useAuth((s) => perfilDe(s.usuario?.permisos ?? []) === 'tecnico')
  return esTecnico ? <Navigate to="/bandeja?vista=reportadas" replace /> : <MisReportes />
}

/** "Mis reportes" (T-045): incidencias reportadas por el usuario, filtrables por estado en la URL (?estado=). */
function MisReportes() {
  const [params, setParams] = useSearchParams()
  const { abrir, panel } = usePanelIncidencia()
  const crudo = params.get('estado')
  const estado = esEstado(crudo) ? crudo : undefined
  // Se piden todas y se filtra aquí: así cada filtro muestra cuántas tiene.
  const { data: todas, isPending, isError, isFetching, refetch } = useIncidencias({ propias: true })
  const data = (estado ? todas?.filter((t) => t.estado === estado) : todas) ?? []
  const puedeReportar = useAuth((s) => s.tiene('incidencias:crear'))

  const filtrar = (nuevo?: Estado) => {
    const siguiente = new URLSearchParams(params)
    if (nuevo) siguiente.set('estado', nuevo)
    else siguiente.delete('estado')
    setParams(siguiente, { replace: true })
  }

  const base = estado && !FILTROS.some((f) => f.valor === estado)
    ? [...FILTROS, { valor: estado, texto: ETIQUETAS.estado[estado] }]
    : FILTROS
  const opciones: OpcionChip<Filtro>[] = base.map((f) => ({
    ...f,
    cuenta: todas && (f.valor === 'todos' ? todas.length : todas.filter((t) => t.estado === f.valor).length),
  }))

  return (
    <>
      <PageHeader
        titulo="Mis reportes"
        subtitulo="Sigue el estado de cada falla que reportaste"
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

      <FiltroChips<Filtro>
        etiqueta="Filtrar por estado"
        valor={estado ?? 'todos'}
        opciones={opciones}
        onCambio={(v) => filtrar(v === 'todos' ? undefined : v)}
        className="mb-4"
      />

      {isPending && <SkeletonLista etiqueta="Cargando tus reportes" />}

      {isError && (
        <ErrorState
          titulo="No pudimos cargar tus reportes"
          mensaje="Revisa tu conexión e intenta de nuevo."
          onReintentar={() => void refetch()}
          reintentando={isFetching}
        />
      )}

      {!isPending && !isError && data.length === 0 && (
        estado ? (
          <EmptyState
            titulo={`No tienes reportes en estado ${ETIQUETAS.estado[estado]}`}
            descripcion="Prueba con otro estado o revisa todos tus reportes."
            icono={ClipboardList}
            accion={<Button variante="secundario" onClick={() => filtrar()}>Ver todos</Button>}
          />
        ) : (
          <EmptyState
            titulo="Aún no tienes reportes"
            descripcion="Toma una foto de la falla, revisa lo que llena la IA y envíala. Aquí verás su avance."
            icono={ClipboardList}
            accion={puedeReportar ? (
              <Link to="/reportar" className="ui-btn ui-btn--primario ui-btn--lg">
                <Camera size={20} aria-hidden /> Reportar
              </Link>
            ) : undefined}
          />
        )
      )}

      {!isPending && !isError && data.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {data.map((t) => (
            <li key={t._id}>
              <TarjetaIncidencia incidencia={t} onAbrir={abrir} />
            </li>
          ))}
        </ul>
      )}
      {panel}
    </>
  )
}
