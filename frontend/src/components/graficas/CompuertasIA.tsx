import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { MetricasIA } from '../../schemas/metricasIA'

type Compuerta = MetricasIA['compuertas_fallidas'][number]

export function CompuertasIA({ datos }: { datos: Compuerta[] }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-72 w-full" role="img" aria-label="Gráfica de barras de compuertas de IA fallidas">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={datos} margin={{ top: 12, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid stroke="var(--color-border)" vertical={false} />
            <XAxis dataKey="compuerta" tick={{ fill: 'var(--color-text-muted)' }} />
            <YAxis allowDecimals={false} tick={{ fill: 'var(--color-text-muted)' }} />
            <Tooltip
              formatter={(valor) => [Number(valor), 'Fallos']}
              contentStyle={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', borderColor: 'var(--color-border)' }}
              labelStyle={{ color: 'var(--color-text)' }}
            />
            <Bar dataKey="total" name="Fallos" fill="var(--color-primary)" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-ink">Ver tabla de compuertas fallidas</summary>
        <table className="w-full text-left text-sm">
          <caption className="py-2 text-left text-muted">Frecuencia por identificador oficial G1–G9</caption>
          <thead><tr><th scope="col" className="p-2">Compuerta</th><th scope="col" className="p-2">Fallos</th></tr></thead>
          <tbody>{datos.map((fila) => (
            <tr key={fila.compuerta} className="border-t border-[var(--color-border)]">
              <th scope="row" className="p-2">{fila.compuerta}</th><td className="p-2">{fila.total}</td>
            </tr>
          ))}</tbody>
        </table>
      </details>
    </div>
  )
}
