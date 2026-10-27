import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { MetricasIA } from '../../schemas/metricasIA'
import { Tabla, claseNumerica } from '../ui/Tabla'
import { animarGraficas, cursorBarra, ejeLinea, ejeTick, rejilla, tooltipContenido, tooltipEtiqueta } from './comun'

type CostoDiario = MetricasIA['costos']['diario'][number]
const dinero = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'USD', maximumFractionDigits: 6 })
const dineroCorto = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
// `fecha` es un día calendario UTC del backend: se formatea en UTC para no recorrerlo.
const formatoDia = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const dia = (iso: string) => formatoDia.format(new Date(`${iso}T00:00:00Z`))

export function CostosIA({ datos }: { datos: CostoDiario[] }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-60 w-full" role="img" aria-label="Gráfica de barras del costo estimado diario de inteligencia artificial">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={datos} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={rejilla} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="fecha" tick={ejeTick} axisLine={ejeLinea} tickLine={false} tickFormatter={dia} minTickGap={12} />
            <YAxis tick={ejeTick} axisLine={false} tickLine={false} width={56} tickFormatter={(v) => dineroCorto.format(Number(v))} />
            <Tooltip
              cursor={cursorBarra}
              formatter={(valor) => [dinero.format(Number(valor)), 'Costo estimado']}
              labelFormatter={(etiqueta) => dia(String(etiqueta))}
              contentStyle={tooltipContenido}
              labelStyle={tooltipEtiqueta}
            />
            <Bar dataKey="costo_estimado_usd" name="Costo estimado" fill="var(--color-secondary)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={animarGraficas()} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details>
        <summary className="cursor-pointer py-3 text-sm font-semibold text-ink">Ver tabla de costos diarios</summary>
        <Tabla etiqueta="Costo estimado, no facturado, por día" densa className="mt-2">
          <thead><tr><th scope="col">Fecha</th><th scope="col" className={claseNumerica}>Llamadas</th><th scope="col" className={claseNumerica}>Costo estimado</th></tr></thead>
          <tbody>{datos.map((fila) => (
            <tr key={fila.fecha}>
              <th scope="row">{dia(fila.fecha)}</th>
              <td className={claseNumerica}>{fila.llamadas_con_costo}</td>
              <td className={claseNumerica}>{dinero.format(fila.costo_estimado_usd)}</td>
            </tr>
          ))}</tbody>
        </Tabla>
      </details>
    </div>
  )
}
