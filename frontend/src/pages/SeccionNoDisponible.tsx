import { Construction, SearchX } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { SinAcceso } from '../auth/RequirePermiso'
import { usePermiso } from '../auth/usePermiso'
import { accesoDe } from '../components/navegacion'
import { EmptyState } from '../components/ui'

/**
 * Rutas sin pantalla: si están en la matriz respeta su permiso («Sin acceso») y avisa que la
 * sección aún no está lista; si no, «Página no encontrada». Nunca deja el contenido en blanco.
 */
export default function SeccionNoDisponible() {
  const { pathname } = useLocation()
  const acceso = accesoDe(pathname)
  const permitido = usePermiso(acceso ?? {})
  const volver = <Link to="/" className="ui-btn ui-btn--secundario">Ir al inicio</Link>
  if (!acceso) return <EmptyState icono={SearchX} titulo="Página no encontrada" descripcion="La dirección no existe o cambió." accion={volver} />
  if (!permitido) return <SinAcceso />
  return <EmptyState icono={Construction} titulo="Sección en preparación" descripcion="Esta sección todavía no está disponible." accion={volver} />
}
