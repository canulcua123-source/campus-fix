import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TendenciaMensual } from '../../schemas/analitica'
import { ETIQUETAS_CATEGORIA } from '../../schemas/etiquetas'
import { CATEGORIAS } from '../../schemas/incidencia'
import { Tabla, claseNumerica } from '../ui/Tabla'
import { animarGraficas, cursorBarra, ejeLinea, ejeTick, rejilla, tooltipContenido, tooltipEtiqueta } from './comun'

const COLOR: Record<(typeof CATEGORIAS)[number], string> = {
  computo_redes: 'var(--categoria-computo-redes)',
  infraestructura: 'var(--categoria-infraestructura)',
  academico: 'var(--categoria-academico)',
}
const numero = new Intl.NumberFormat('es-MX')
// Periodos "YYYY-MM" en UTC (backend): se formatean en UTC para no recorrer el mes.
const formatoMesCorto = new Intl.DateTimeFormat('es-MX', { month: 'short', year: '2-digit', timeZone: 'UTC' })
const formatoMes = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const fechaDe = (periodo: string) => {
  const [anio, m] = periodo.split('-').map(Number)
  return new Date(Date.UTC(anio, m - 1, 1))
}
const mesLargo = (periodo: string) => formatoMes.format(fechaDe(periodo))

type Fila = { periodo: string; total: number } & Partial<Record<(typeof CATEGORIAS)[number], number>>

/** Pivotea [{periodo, categoria, total}] a una fila por mes con una columna por categoría. */
function pivotearTendencia(datos: TendenciaMensual[]): Fila[] {
  const porMes = new Map<string, Fila>()
  for (const d of datos) {
    const fila = porMes.get(d.periodo) ?? { periodo: d.periodo, total: 0 }
    fila[d.categoria] = (fila[d.categoria] ?? 0) + d.total
    fila.total += d.total
    porMes.set(d.periodo, fila)
  }
  return [...porMes.values()].sort((a, b) => a.periodo.localeCompare(b.periodo))
}

/** Incidencias creadas por mes, apiladas por categoría (colores de categoría de tokens). */
export function TendenciaCategorias({ datos }: { datos: TendenciaMensual[] }) {
  const filas = pivotearTendencia(datos)
  const animar = animarGraficas()
  return (
    <div className="flex flex-col gap-3">
      <div className="h-64 w-full" role="img" aria-label="Gráfica de barras apiladas: incidencias creadas por mes y categoría">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={filas} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid stroke={rejilla} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="periodo" tick={ejeTick} axisLine={ejeLinea} tickLine={false} tickFormatter={(p) => formatoMesCorto.format(fechaDe(String(p)))} />
            <YAxis allowDecimals={false} tick={ejeTick} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={cursorBarra}
              formatter={(valor, nombre) => [numero.format(Number(valor)), String(nombre)]}
              labelFormatter={(p) => mesLargo(String(p))}
              contentStyle={tooltipContenido}
              labelStyle={tooltipEtiqueta}
            />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: 'var(--color-text-muted)' }} />
            {CATEGORIAS.map((c, i) => (
              <Bar
                key={c} dataKey={c} name={ETIQUETAS_CATEGORIA[c]} stackId="total" fill={COLOR[c]} maxBarSize={48}
                radius={i === CATEGORIAS.length - 1 ? [4, 4, 0, 0] : undefined} isAnimationActive={animar}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-ink">Ver tabla de tendencia</summary>
        <Tabla etiqueta="Incidencias creadas por mes y categoría" densa className="mt-2">
          <thead>
            <tr>
              <th scope="col">Mes</th>
              {CATEGORIAS.map((c) => <th key={c} scope="col" className={claseNumerica}>{ETIQUETAS_CATEGORIA[c]}</th>)}
              <th scope="col" className={claseNumerica}>Total</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.periodo}>
                <th scope="row">{mesLargo(f.periodo)}</th>
                {CATEGORIAS.map((c) => <td key={c} className={claseNumerica}>{numero.format(f[c] ?? 0)}</td>)}
                <td className={claseNumerica}>{numero.format(f.total)}</td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      </details>
    </div>
  )
}
