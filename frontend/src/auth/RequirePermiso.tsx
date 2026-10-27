import { ShieldX } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { cumpleAcceso, rutaInicio, type Acceso } from '../components/navegacion'
import { EmptyState, Spinner } from '../components/ui'
import { useAuth } from './store'
import { usePermiso } from './usePermiso'

/** Pantalla para rutas abiertas por URL sin el permiso de la matriz (nunca pantalla en blanco). */
export function SinAcceso() {
  return (
    <EmptyState
      icono={ShieldX}
      titulo="Sin acceso"
      descripcion="Tu rol no tiene permiso para ver esta pantalla. Si crees que es un error, pide a la administración que revise tu cuenta."
      accion={<Link to="/" className="ui-btn ui-btn--secundario">Ir al inicio</Link>}
    />
  )
}

/**
 * Guarda de ruta: sin sesión → /login (conservando el destino); mientras se restaura la sesión →
 * spinner; sin permiso/rol → su pantalla principal (la ruta no existe para su rol). La seguridad real está en la API (403/404).
 */
export function RequirePermiso({ permiso, rol, children }: Acceso & { children: ReactNode }) {
  const usuario = useAuth((s) => s.usuario)
  const restaurando = useAuth((s) => s.restaurando)
  const location = useLocation()
  if (!usuario && restaurando) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner tamano={32} etiqueta="Recuperando tu sesión" />
      </div>
    )
  }
  if (!usuario) return <Navigate to="/login" replace state={{ desde: `${location.pathname}${location.search}` }} />
  if (!cumpleAcceso({ permiso, rol }, usuario.permisos, usuario.rol)) {
    return <Navigate to={rutaInicio(usuario.permisos, usuario.rol)} replace />
  }
  return <>{children}</>
}

/** Guarda de acción: muestra botones/acciones solo con el permiso (UX-31); `alternativa` en otro caso. */
export function SiPermiso({ permiso, rol, alternativa = null, children }: Acceso & { alternativa?: ReactNode; children: ReactNode }) {
  return usePermiso({ permiso, rol }) ? <>{children}</> : <>{alternativa}</>
}
