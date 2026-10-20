import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './store'

export function RequirePermiso({ permiso, children }: { permiso?: string; children: ReactNode }) {
  const usuario = useAuth((s) => s.usuario)
  if (!usuario) return <Navigate to="/login" replace />
  if (permiso && !usuario.permisos.includes(permiso)) return <Navigate to="/" replace />
  return <>{children}</>
}
