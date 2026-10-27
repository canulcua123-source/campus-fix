import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AnaliticaTag } from '../../schemas/analitica'
import { Tabla, claseNumerica } from '../ui/Tabla'
import { animarGraficas, cursorBarra, ejeLinea, ejeTick, rejilla, tooltipContenido, tooltipEtiqueta } from './comun'

const numero = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 })

/** Los tags llegan ordenados por el pipeline; no alterar ese ranking en el navegador. */
export function TopTags({ datos }: { datos: AnaliticaTag[] }) {
  // Alto según el número de barras: 10 etiquetas no deben aplastarse ni 2 flotar en un lienzo enorme.
  const alto = Math.max(140, datos.length * 30 + 40)
  return (
    <div className="flex flex-col gap-3">
      <div className="w-full" style={{ height: alto }} role="img" aria-label="Gráfica de barras: diez etiquetas de incidencias más frecuentes">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={datos} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={rejilla} strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={ejeTick} axisLine={ejeLinea} tickLine={false} />
            <YAxis type="category" dataKey="tag" width={100} tick={ejeTick} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={cursorBarra}
              formatter={(valor) => [numero.format(Number(valor)), 'Incidencias']}
              contentStyle={tooltipContenido}
              labelStyle={tooltipEtiqueta}
            />
            <Bar dataKey="total" name="Incidencias" fill="var(--color-secondary)" radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={animarGraficas()} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-ink">Ver tabla de etiquetas</summary>
        <Tabla etiqueta="Diez etiquetas más frecuentes, en orden del backend" densa className="mt-2">
          <thead>
            <tr><th scope="col" className={claseNumerica}>Posición</th><th scope="col">Etiqueta</th><th scope="col" className={claseNumerica}>Incidencias</th></tr>
          </thead>
          <tbody>
            {datos.map((fila, posicion) => (
              <tr key={fila.tag}>
                <td className={claseNumerica}>{posicion + 1}</td>
                <th scope="row">{fila.tag}</th>
                <td className={claseNumerica}>{fila.total}</td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      </details>
    </div>
  )
}
