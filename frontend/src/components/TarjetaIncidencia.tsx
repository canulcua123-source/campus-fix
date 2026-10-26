import { Link } from 'react-router-dom'
import { haceCuanto } from '../lib/tiempo'
import type { IncidenciaListaItem } from '../schemas/incidencia'
import { Badge, claseCardInteractiva } from './ui'

interface TarjetaIncidenciaProps {
  incidencia: IncidenciaListaItem
  /** Muestra el técnico asignado (tablero del coordinador). */
  mostrarTecnico?: boolean
}

/** Tarjeta de lista que abre el detalle de la incidencia (toda la tarjeta es el enlace, ≥ 44 px). */
export function TarjetaIncidencia({ incidencia: t, mostrarTecnico = false }: TarjetaIncidenciaProps) {
  return (
    <Link to={`/incidencias/${encodeURIComponent(t._id)}`} className={`${claseCardInteractiva} block min-h-11 no-underline text-ink`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted">{t.codigo}</span>
        <span className="text-xs text-muted">{haceCuanto(t.fecha_creacion)}</span>
      </div>
      <div className="my-1 font-semibold">{t.titulo}</div>
      <div className="mb-2 text-sm text-muted">
        {[t.ubicacion.edificio, t.ubicacion.aula].filter(Boolean).join(' · ')}
        {mostrarTecnico && ` · ${t.tecnico_asignado ? t.tecnico_asignado.nombre : 'Sin asignar'}`}
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge tipo="estado" valor={t.estado} />
        <Badge tipo="prioridad" valor={t.prioridad} />
        <Badge tipo="categoria" valor={t.categoria} />
      </div>
    </Link>
  )
}
