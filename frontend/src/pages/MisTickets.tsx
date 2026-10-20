import { Badge } from '../components/Badge'

// Marcador de posición: se conectará a GET /incidencias con TanStack Query.
const EJEMPLOS = [
  { codigo: 'INC-2026-1020-RED-0001', titulo: 'Sin conexión en laboratorio 3', estado: 'en_proceso', prioridad: 'alta', categoria: 'computo_redes' },
  { codigo: 'INC-2026-1019-INF-0004', titulo: 'Luminaria fundida en pasillo B', estado: 'abierta', prioridad: 'media', categoria: 'infraestructura' },
  { codigo: 'INC-2026-1015-ACA-0002', titulo: 'Calificaciones no visibles', estado: 'resuelta', prioridad: 'baja', categoria: 'academico' },
]

export default function MisTickets() {
  return (
    <>
      <h1 className="titulo-pagina">Mis tickets</h1>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {EJEMPLOS.map((t) => (
          <li key={t.codigo} className="card">
            <div className="text-xs text-muted">{t.codigo}</div>
            <div className="my-1 font-semibold">{t.titulo}</div>
            <div className="flex flex-wrap gap-2">
              <Badge tipo="estado" valor={t.estado} />
              <Badge tipo="prioridad" valor={t.prioridad} />
              <Badge tipo="categoria" valor={t.categoria} />
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
