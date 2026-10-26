import { cumpleAcceso, type Acceso } from '../components/navegacion'
import { useAuth } from './store'

/** true si la sesión actual cumple el acceso (permiso y, si aplica, rol). */
export function usePermiso(acceso: Acceso): boolean {
  const usuario = useAuth((s) => s.usuario)
  return usuario ? cumpleAcceso(acceso, usuario.permisos, usuario.rol) : false
}
