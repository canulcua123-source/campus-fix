import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { MetricasIA } from '../../schemas/metricasIA'

type CostoDiario = MetricasIA['costos']['diario'][number]
const dinero = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'USD', maximumFractionDigits: 6 })

export function CostosIA({ datos }: { datos: CostoDiario[] }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-72 w-full" role="img" aria-label="Gráfica de barras del costo estimado diario de inteligencia artificial">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={datos} margin={{ top: 12, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid stroke="var(--color-border)" vertical={false} />
            <XAxis dataKey="fecha" tick={{ fill: 'var(--color-text-muted)' }} />
            <YAxis tick={{ fill: 'var(--color-text-muted)' }} />
            <Tooltip
              formatter={(valor) => [dinero.format(Number(valor)), 'Costo estimado']}
              contentStyle={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', borderColor: 'var(--color-border)' }}
              labelStyle={{ color: 'var(--color-text)' }}
            />
            <Bar dataKey="costo_estimado_usd" name="Costo estimado" fill="var(--color-secondary)" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-ink">Ver tabla de costos diarios</summary>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="py-2 text-left text-muted">Costo estimado, no facturado, por día</caption>
            <thead><tr><th scope="col" className="p-2">Fecha</th><th scope="col" className="p-2">Llamadas</th><th scope="col" className="p-2">Costo estimado</th></tr></thead>
            <tbody>{datos.map((fila) => (
              <tr key={fila.fecha} className="border-t border-[var(--color-border)]">
                <th scope="row" className="p-2">{fila.fecha}</th>
                <td className="p-2">{fila.llamadas_con_costo}</td>
                <td className="p-2">{dinero.format(fila.costo_estimado_usd)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
