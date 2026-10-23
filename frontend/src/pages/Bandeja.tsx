import { Inbox } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useIncidencias } from '../api/hooks/incidencias'
import { useAuth } from '../auth/store'
import { Badge } from '../components/Badge'
import { EmptyState, ErrorState, Skeleton } from '../components/ui'
import { antiguedad, filtrarBandeja, ordenarBandeja, type PestanaBandeja } from '../lib/bandeja'

const PESTANAS: { clave: PestanaBandeja; texto: string }[] = [
  { clave: 'mias', texto: 'Mis asignadas' },
  { clave: 'sin_asignar', texto: 'Sin asignar' },
]

const TONO_SLA = { normal: 'text-muted', atencion: 'text-warn', vencida: 'text-bad' } as const

export default function Bandeja() {
  const [pestana, setPestana] = useState<PestanaBandeja>('mias')
  const { usuario } = useAuth()
  const { data, isPending, isError, refetch, isFetching } = useIncidencias({})

  const lista = ordenarBandeja(filtrarBandeja(data ?? [], pestana, usuario?.nombre))

  return (
    <>
      <h1 className="titulo-pagina">Bandeja del técnico</h1>

      <div role="tablist" aria-label="Incidencias de la bandeja" className="mb-4 flex gap-1 rounded-full border border-line bg-panel p-1">
        {PESTANAS.map((p) => (
          <button
            key={p.clave}
            type="button"
            role="tab"
            aria-selected={pestana === p.clave}
            className={`min-h-11 flex-1 rounded-full px-4 text-sm font-semibold ${
              pestana === p.clave ? 'bg-brand text-on-brand' : 'text-muted'
            }`}
            onClick={() => setPestana(p.clave)}
          >
            {p.texto}
          </button>
        ))}
      </div>

      {isPending && (
        <div className="flex flex-col gap-3" role="status" aria-label="Cargando bandeja">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card flex flex-col gap-2">
              <Skeleton ancho="35%" alto={10} />
              <Skeleton ancho="80%" alto={18} />
              <div className="flex gap-2">
                <Skeleton ancho={70} alto={20} redondo />
                <Skeleton ancho={70} alto={20} redondo />
              </div>
            </div>
          ))}
        </div>
      )}

      {isError && (
        <ErrorState
          titulo="No pudimos cargar la bandeja"
          mensaje="Revisa tu conexión e intenta de nuevo."
          onReintentar={() => void refetch()}
          reintentando={isFetching}
        />
      )}

      {!isPending && !isError && lista.length === 0 && (
        <EmptyState
          titulo={pestana === 'mias' ? 'Sin incidencias asignadas' : 'Sin incidencias por asignar'}
          descripcion={
            pestana === 'mias'
              ? 'Cuando te asignen una incidencia de tu área aparecerá aquí.'
              : 'No hay incidencias pendientes de asignación en tu área.'
          }
          icono={Inbox}
        />
      )}

      {!isPending && !isError && lista.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {lista.map((t) => {
            const sla = antiguedad(t.fecha_creacion)
            return (
              <li key={t._id}>
                <Link to={`/incidencias/${t._id}`} className="card block no-underline text-ink">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-muted">{t.codigo}</span>
                    <span className={`text-xs font-semibold ${TONO_SLA[sla.nivel]}`}>{sla.texto}</span>
                  </div>
                  <div className="my-1 font-semibold">{t.titulo}</div>
                  <div className="mb-2 text-sm text-muted">
                    {[t.ubicacion.edificio, t.ubicacion.aula].filter(Boolean).join(' · ')}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tipo="prioridad" valor={t.prioridad} />
                    <Badge tipo="estado" valor={t.estado} />
                    <Badge tipo="categoria" valor={t.categoria} />
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
