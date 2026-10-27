import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { MetricasIA } from '../../schemas/metricasIA'
import { Tabla, claseNumerica } from '../ui/Tabla'
import { animarGraficas, cursorBarra, ejeLinea, ejeTick, rejilla, tooltipContenido, tooltipEtiqueta } from './comun'

type Compuerta = MetricasIA['compuertas_fallidas'][number]

export function CompuertasIA({ datos }: { datos: Compuerta[] }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-60 w-full" role="img" aria-label="Gráfica de barras de compuertas de IA fallidas">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={datos} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid stroke={rejilla} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="compuerta" tick={ejeTick} axisLine={ejeLinea} tickLine={false} />
            <YAxis allowDecimals={false} tick={ejeTick} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={cursorBarra}
              formatter={(valor) => [Number(valor), 'Fallos']}
              labelFormatter={(etiqueta) => `Compuerta ${String(etiqueta)}`}
              contentStyle={tooltipContenido}
              labelStyle={tooltipEtiqueta}
            />
            <Bar dataKey="total" name="Fallos" fill="var(--color-primary)" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={animarGraficas()} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-ink">Ver tabla de compuertas fallidas</summary>
        <Tabla etiqueta="Frecuencia por identificador oficial G1–G9" densa className="mt-2">
          <thead><tr><th scope="col">Compuerta</th><th scope="col" className={claseNumerica}>Fallos</th></tr></thead>
          <tbody>{datos.map((fila) => (
            <tr key={fila.compuerta}>
              <th scope="row">{fila.compuerta}</th><td className={claseNumerica}>{fila.total}</td>
            </tr>
          ))}</tbody>
        </Tabla>
      </details>
    </div>
  )
}
