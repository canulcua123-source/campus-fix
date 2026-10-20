import { Badge } from '../components/Badge'

// Marcador de posición de la bandeja del técnico.
const PENDIENTES = [
  { codigo: 'INC-2026-1020-RED-0001', titulo: 'Switch de piso reiniciándose', estado: 'abierta', prioridad: 'critica' },
  { codigo: 'INC-2026-1018-INF-0003', titulo: 'Filtración en techo del aula 204', estado: 'en_espera', prioridad: 'alta' },
]

export default function Bandeja() {
  return (
    <>
      <h1 className="titulo-pagina">Bandeja del técnico</h1>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {PENDIENTES.map((t) => (
          <li key={t.codigo} className="card flex items-center justify-between gap-3">
            <div>
              <div className="text-xs text-muted">{t.codigo}</div>
              <div className="font-semibold">{t.titulo}</div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Badge tipo="prioridad" valor={t.prioridad} />
              <Badge tipo="estado" valor={t.estado} />
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
