import { Badge } from '../components/Badge'

// Marcador de posición; se conectará a GET /categorias.
const CATEGORIAS = [
  { clave: 'computo_redes', area: 'Tecnologías de la Información' },
  { clave: 'infraestructura', area: 'Servicios Generales' },
  { clave: 'academico', area: 'Servicios Escolares' },
]

export default function AdminCategorias() {
  return (
    <>
      <h1 className="titulo-pagina">Categorías</h1>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {CATEGORIAS.map((c) => (
          <li key={c.clave} className="card flex items-center justify-between">
            <Badge tipo="categoria" valor={c.clave} />
            <span className="text-sm text-muted">{c.area}</span>
          </li>
        ))}
      </ul>
    </>
  )
}
