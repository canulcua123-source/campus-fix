import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AnaliticaEdificio } from '../../schemas/analitica'

const numero = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 })

/** Se muestran magnitudes distintas, ambas expresadas en horas.
 * horas_invertidas = suma registrada; horas_resolucion_prom = tiempo calendario medio hasta resolver.
 * El backend solo agrupa incidencias resueltas/cerradas. */
export function HorasEdificio({ datos }: { datos: AnaliticaEdificio[] }) {
    return (
        <div className="flex flex-col gap-3">
            <div className="h-72 w-full" role="img" aria-label="Gráfica de barras: horas invertidas y promedio de resolución por edificio">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={datos} margin={{ top: 16, right: 16, left: 8, bottom: 8 }}>
                        <CartesianGrid stroke="var(--color-border)" vertical={false} />
                        <XAxis dataKey="edificio" tick={{ fill: 'var(--color-text-muted)' }} interval={0} />
                        <YAxis tick={{ fill: 'var(--color-text-muted)' }} allowDecimals />
                        <Tooltip
                            formatter={(valor, nombre) => [`${numero.format(Number(valor))} h`, String(nombre)]}
                            contentStyle={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', borderColor: 'var(--color-border)' }}
                            labelStyle={{ color: 'var(--color-text)' }}
                        />
                        <Legend />
                        <Bar dataKey="horas_invertidas" name="Horas invertidas" fill="var(--color-primary)" />
                        <Bar dataKey="horas_resolucion_prom" name="Resolución promedio (h)" fill="var(--color-secondary)" />
                    </BarChart>
                </ResponsiveContainer>
            </div>
            <details>
                <summary className="cursor-pointer text-sm font-semibold text-ink">Ver tabla de horas por edificio</summary>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <caption className="py-2 text-left text-muted">Totales y promedios de incidencias resueltas por edificio</caption>
                        <thead>
                            <tr>
                                <th scope="col" className="p-2">Edificio</th>
                                <th scope="col" className="p-2">Resueltas</th>
                                <th scope="col" className="p-2">Horas invertidas</th>
                                <th scope="col" className="p-2">Resolución promedio (h)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {datos.map((fila) => (
                                <tr key={fila.edificio} className="border-t border-[var(--color-border)]">
                                    <th scope="row" className="p-2">{fila.edificio}</th>
                                    <td className="p-2">{fila.total}</td>
                                    <td className="p-2">{numero.format(fila.horas_invertidas)}</td>
                                    <td className="p-2">{fila.horas_resolucion_prom === null ? 'Sin dato' : numero.format(fila.horas_resolucion_prom)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </details>
        </div>
    )
}