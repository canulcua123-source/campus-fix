import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { meQuery } from '../api/auth'
import { useAuth, type Usuario } from './store'

/** Cada cuánto se relee /auth/me con la pestaña visible. */
export const INTERVALO_SESION_MS = 60_000

const firma = (u: Usuario) => JSON.stringify([u.nombre, u.rol, u.alcance, [...u.permisos].sort()])

/**
 * Mantiene rol y permisos de la sesión al día con la API: si un superadmin cambia el rol de esta
 * cuenta, el menú y las guardas de ruta cambian sin cerrar sesión. La seguridad real sigue en la API.
 */
export function useSincronizarSesion() {
  const token = useAuth((s) => s.token)
  const { data } = useQuery({
    ...meQuery(),
    enabled: Boolean(token),
    refetchInterval: INTERVALO_SESION_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
  })
  useEffect(() => {
    if (!data) return
    const actual = useAuth.getState().usuario
    const nuevo: Usuario = { nombre: data.nombre, rol: data.rol, permisos: data.permisos, alcance: data.alcance }
    if (!actual || firma(actual) !== firma(nuevo)) useAuth.getState().actualizarUsuario(nuevo)
  }, [data])
}
