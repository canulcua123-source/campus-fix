import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AnaliticaEdificio } from '../../schemas/analitica'
import { Tabla, claseNumerica } from '../ui/Tabla'
import { animarGraficas, cursorBarra, ejeLinea, ejeTick, rejilla, tooltipContenido, tooltipEtiqueta } from './comun'

const numero = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 })

/** Se muestran magnitudes distintas, ambas expresadas en horas.
 * horas_invertidas = suma registrada; horas_resolucion_prom = tiempo calendario medio hasta resolver.
 * El backend solo agrupa incidencias resueltas/cerradas. */
export function HorasEdificio({ datos }: { datos: AnaliticaEdificio[] }) {
  const animar = animarGraficas()
  return (
    <div className="flex flex-col gap-3">
      <div className="h-64 w-full" role="img" aria-label="Gráfica de barras: horas invertidas y promedio de resolución por edificio">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={datos} margin={{ top: 8, right: 8, left: -8, bottom: 0 }} barGap={2}>
            <CartesianGrid stroke={rejilla} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="edificio" tick={ejeTick} axisLine={ejeLinea} tickLine={false} interval={0} />
            <YAxis tick={ejeTick} axisLine={false} tickLine={false} allowDecimals width={44} unit=" h" />
            <Tooltip
              cursor={cursorBarra}
              formatter={(valor, nombre) => [`${numero.format(Number(valor))} h`, String(nombre)]}
              labelFormatter={(etiqueta) => `Edificio ${String(etiqueta)}`}
              contentStyle={tooltipContenido}
              labelStyle={tooltipEtiqueta}
            />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: 'var(--color-text-muted)' }} />
            <Bar dataKey="horas_invertidas" name="Horas invertidas" fill="var(--color-primary)" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={animar} />
            <Bar dataKey="horas_resolucion_prom" name="Resolución promedio" fill="var(--color-secondary)" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={animar} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-ink">Ver tabla de horas por edificio</summary>
        <Tabla etiqueta="Totales y promedios de incidencias resueltas por edificio" densa className="mt-2">
          <thead>
            <tr>
              <th scope="col">Edificio</th>
              <th scope="col" className={claseNumerica}>Resueltas</th>
              <th scope="col" className={claseNumerica}>Horas invertidas</th>
              <th scope="col" className={claseNumerica}>Resolución promedio (h)</th>
            </tr>
          </thead>
          <tbody>
            {datos.map((fila) => (
              <tr key={fila.edificio}>
                <th scope="row">{fila.edificio}</th>
                <td className={claseNumerica}>{fila.total}</td>
                <td className={claseNumerica}>{numero.format(fila.horas_invertidas)}</td>
                <td className={claseNumerica}>{fila.horas_resolucion_prom === null ? 'Sin dato' : numero.format(fila.horas_resolucion_prom)}</td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      </details>
    </div>
  )
}
