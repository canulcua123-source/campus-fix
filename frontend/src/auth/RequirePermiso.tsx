import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './store'

export function RequirePermiso({ permiso, children }: { permiso?: string; children: ReactNode }) {
  const usuario = useAuth((s) => s.usuario)
  const location = useLocation()
  if (!usuario) return <Navigate to="/login" replace state={{ desde: `${location.pathname}${location.search}` }} />
  if (permiso && !usuario.permisos.includes(permiso)) return <Navigate to="/" replace />
  return <>{children}</>
}
