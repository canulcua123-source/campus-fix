import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AnaliticaTag } from '../../schemas/analitica'

const numero = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 })

/** Los tags llegan ordenados por el pipeline; no alterar ese ranking en el navegador. */
export function TopTags({ datos }: { datos: AnaliticaTag[] }) {
    return (
        <div className="flex flex-col gap-3">
            <div className="h-72 w-full" role="img" aria-label="Gráfica de barras: diez etiquetas de incidencias más frecuentes">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={datos} layout="vertical" margin={{ top: 8, right: 20, bottom: 8, left: 10 }}>
                        <CartesianGrid stroke="var(--color-border)" horizontal={false} />
                        <XAxis type="number" allowDecimals={false} tick={{ fill: 'var(--color-text-muted)' }} />
                        <YAxis type="category" dataKey="tag" width={94} tick={{ fill: 'var(--color-text-muted)' }} />
                        <Tooltip
                            formatter={(valor) => [numero.format(Number(valor)), 'Incidencias']}
                            contentStyle={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', borderColor: 'var(--color-border)' }}
                            labelStyle={{ color: 'var(--color-text)' }}
                        />
                        <Bar dataKey="total" name="Incidencias" fill="var(--color-secondary)" />
                    </BarChart>
                </ResponsiveContainer>
            </div>
            <details>
                <summary className="cursor-pointer text-sm font-semibold text-ink">Ver tabla de etiquetas</summary>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <caption className="py-2 text-left text-muted">Diez etiquetas más frecuentes, en orden del backend</caption>
                        <thead>
                            <tr><th scope="col" className="p-2">Posición</th><th scope="col" className="p-2">Etiqueta</th><th scope="col" className="p-2">Incidencias</th></tr>
                        </thead>
                        <tbody>
                            {datos.map((fila, posicion) => (
                                <tr key={fila.tag} className="border-t border-[var(--color-border)]">
                                    <td className="p-2">{posicion + 1}</td>
                                    <th scope="row" className="p-2">{fila.tag}</th>
                                    <td className="p-2">{fila.total}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </details>
        </div>
    )
}