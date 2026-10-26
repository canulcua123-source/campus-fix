import { Camera, ClipboardList } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/store'

export default function Inicio() {
  const { usuario, tiene } = useAuth()
  return (
    <>
      <h1 className="titulo-pagina">Hola, {usuario?.nombre}</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        {tiene('incidencias:crear') && (
          <Link to="/reportar" className="card flex items-center gap-3 text-ink no-underline">
            <Camera className="text-brand" aria-hidden /> Reportar una incidencia
          </Link>
        )}
        {tiene('incidencias:ver') && (
          <Link to="/mis-reportes" className="card flex items-center gap-3 text-ink no-underline">
            <ClipboardList className="text-brand" aria-hidden /> Ver mis reportes
          </Link>
        )}
      </div>
    </>
  )
}
