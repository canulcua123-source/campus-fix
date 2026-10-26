import { ClipboardList, RefreshCw } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { useIncidencias } from '../api/hooks/incidencias'
import { useAuth } from '../auth/store'
import { TarjetaIncidencia } from '../components/TarjetaIncidencia'
import { Button, EmptyState, ErrorState, ETIQUETAS, PageHeader, SkeletonLista } from '../components/ui'
import { ESTADOS, type Estado } from '../schemas/incidencia'

const esEstado = (valor: string | null): valor is Estado => ESTADOS.includes(valor as Estado)

/** "Mis reportes" (T-045): incidencias reportadas por el usuario, filtrables por estado en la URL (?estado=). */
export default function MisTickets() {
  const [params, setParams] = useSearchParams()
  const crudo = params.get('estado')
  const estado = esEstado(crudo) ? crudo : undefined
  const { data, isPending, isError, isFetching, refetch } = useIncidencias({ propias: true, estado })
  const puedeReportar = useAuth((s) => s.tiene('incidencias:crear'))

  const filtrar = (nuevo?: Estado) => {
    const siguiente = new URLSearchParams(params)
    if (nuevo) siguiente.set('estado', nuevo)
    else siguiente.delete('estado')
    setParams(siguiente, { replace: true })
  }

  const chips: { valor?: Estado; texto: string }[] = [
    { texto: 'Todos' },
    ...ESTADOS.map((e) => ({ valor: e, texto: ETIQUETAS.estado[e] })),
  ]

  return (
    <>
      <PageHeader
        titulo="Mis reportes"
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

      <div role="group" aria-label="Filtrar por estado" className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {chips.map((c) => {
          const activo = c.valor === estado
          return (
            <button
              key={c.texto}
              type="button"
              aria-pressed={activo}
              className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold ${
                activo ? 'border-brand bg-brand text-on-brand' : 'border-line bg-panel text-muted'
              }`}
              onClick={() => filtrar(c.valor)}
            >
              {c.texto}
            </button>
          )
        })}
      </div>

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
            descripcion="Cuando reportes una falla aparecerá aquí con su estado."
            icono={ClipboardList}
            accion={puedeReportar ? <Link to="/reportar" className="ui-btn ui-btn--primario">Reportar</Link> : undefined}
          />
        )
      )}

      {!isPending && !isError && data.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {data.map((t) => (
            <li key={t._id}>
              <TarjetaIncidencia incidencia={t} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
