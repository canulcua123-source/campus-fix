import { CheckCheck, Clock, Hourglass, Wrench } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useIncidencias } from '../api/hooks/incidencias'
import { antiguedad, ordenarBandeja } from '../lib/bandeja'
import type { IncidenciaListaItem } from '../schemas/incidencia'
import { TarjetaIncidencia } from './TarjetaIncidencia'
import { EmptyState, ErrorState, Seccion, SkeletonLista, StatGrid, StatTile } from './ui'

const numero = new Intl.NumberFormat('es-MX')
const horasFmt = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 })

interface Props {
  tecnicoId: string
  horas: number
  /** Abre el detalle de una incidencia (panel encima de este). */
  onAbrirIncidencia: (id: string) => void
}

/** Toda la operación de un técnico: KPIs y sus incidencias agrupadas por etapa. */
export function OperacionTecnico({ tecnicoId, horas, onAbrirIncidencia }: Props) {
  const consulta = useIncidencias({ tecnico: tecnicoId, limite: 100 })

  if (consulta.isPending) return <SkeletonLista etiqueta="Cargando la operación del técnico" />
  if (consulta.isError) {
    return <ErrorState titulo="No pudimos cargar su operación" mensaje="Intenta de nuevo." onReintentar={() => void consulta.refetch()} reintentando={consulta.isFetching} />
  }

  const todas = consulta.data
  const grupo = (estados: string[]) => ordenarBandeja(todas.filter((t) => estados.includes(t.estado)))
  const enCurso = grupo(['abierta', 'en_proceso'])
  const enEspera = grupo(['en_espera'])
  const porConfirmar = grupo(['resuelta'])
  const cerradas = [...todas.filter((t) => t.estado === 'cerrada')].sort((a, b) => b.fecha_creacion.localeCompare(a.fecha_creacion))

  const lista = (titulo: string, descripcion: string, items: IncidenciaListaItem[]) => items.length > 0 && (
    <Seccion titulo={`${titulo} · ${items.length}`} descripcion={descripcion} nivel={3}>
      <ul className="m-0 grid list-none gap-3 p-0" aria-label={titulo}>
        {items.map((t) => (
          <li key={t._id}>
            <TarjetaIncidencia incidencia={t} onAbrir={onAbrirIncidencia} tonoTiempo={t.estado === 'cerrada' || t.estado === 'resuelta' ? 'normal' : antiguedad(t.fecha_creacion).nivel} />
          </li>
        ))}
      </ul>
    </Seccion>
  )

  return (
    <div className="pila">
      <StatGrid columnas={2} etiqueta="Resumen del técnico">
        <StatTile etiqueta="En curso" valor={numero.format(enCurso.length)} icono={<Wrench size={18} />} tono="brand" />
        <StatTile etiqueta="En espera" valor={numero.format(enEspera.length)} icono={<Hourglass size={18} />} tono={enEspera.length ? 'warning' : 'neutral'} />
        <StatTile etiqueta="Por confirmar" valor={numero.format(porConfirmar.length)} icono={<CheckCheck size={18} />} tono="success" pista={`${numero.format(cerradas.length)} cerradas`} />
        <StatTile etiqueta="Horas acumuladas" valor={`${horasFmt.format(horas)} h`} icono={<Clock size={18} />} />
      </StatGrid>

      {todas.length === 0 && (
        <EmptyState compacto titulo="Sin incidencias asignadas" descripcion="Asígnale incidencias desde el tablero." icono={Wrench} />
      )}
      {lista('En curso', 'Abiertas o en proceso, de mayor a menor prioridad.', enCurso)}
      {lista('En espera', 'Detenidas por falta de pieza, acceso o información.', enEspera)}
      {lista('Por confirmar', 'Resueltas; el reportante tiene 7 días para confirmar o reabrir.', porConfirmar)}
      {lista('Cerradas', 'Confirmadas o cerradas por coordinación.', cerradas)}

      <Link to={`/tablero?tecnico=${encodeURIComponent(tecnicoId)}`} className="ui-btn ui-btn--secundario self-start">Ver en el tablero</Link>
    </div>
  )
}
