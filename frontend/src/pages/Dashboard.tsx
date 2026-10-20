import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

// Datos de ejemplo; se sustituirán por GET /analitica/edificios y /analitica/tags.
const HORAS_EDIFICIO = [
  { edificio: 'A', horas: 31 },
  { edificio: 'B', horas: 18 },
  { edificio: 'C', horas: 24 },
  { edificio: 'Lab', horas: 37 },
]
const TOP_TAGS = [
  { tag: 'wifi', total: 9 },
  { tag: 'red', total: 9 },
  { tag: 'luminaria', total: 7 },
  { tag: 'lms', total: 5 },
  { tag: 'filtracion', total: 4 },
]

function Grafica({ datos, x, y, color }: { datos: object[]; x: string; y: string; color: string }) {
  return (
    <div style={{ width: '100%', height: 240 }}>
      <ResponsiveContainer>
        <BarChart data={datos}>
          <CartesianGrid stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey={x} stroke="var(--color-text-muted)" />
          <YAxis stroke="var(--color-text-muted)" />
          <Tooltip contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }} />
          <Bar dataKey={y} fill={color} radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function Dashboard() {
  return (
    <>
      <h1 className="titulo-pagina">Panel de analítica</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-2 text-base font-semibold">Horas invertidas por edificio</h2>
          <Grafica datos={HORAS_EDIFICIO} x="edificio" y="horas" color="var(--color-primary)" />
        </section>
        <section className="card">
          <h2 className="mb-2 text-base font-semibold">Tags más frecuentes</h2>
          <Grafica datos={TOP_TAGS} x="tag" y="total" color="var(--color-secondary)" />
        </section>
      </div>
    </>
  )
}
