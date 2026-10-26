import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/store'
import { login, logout, meQuery } from '../auth'

/** Perfil de la sesión actual (GET /auth/me). Solo corre con sesión. */
export function useMe() {
  const token = useAuth((s) => s.token)
  return useQuery({ ...meQuery(), enabled: Boolean(token) })
}

/** POST /auth/login → guarda el token en memoria. El 401 aquí es "Correo o contraseña incorrectos". */
export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: login,
    meta: { silencioso: true }, // el formulario muestra el error
    onSuccess: (r) => {
      qc.clear()
      useAuth.getState().iniciarSesion(r.access_token, r.usuario)
    },
  })
}

/**
 * Cierra sesión (FB-06): revoca la cookie de refresh en la API y, aunque falle la red,
 * limpia el token en memoria y toda la caché de TanStack Query.
 */
export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      try {
        await logout()
      } catch (e) {
        if (import.meta.env.DEV) console.info('[auth] logout sin respuesta de la API; se limpia la sesión local', e)
      }
    },
    meta: { silencioso: true },
    onSettled: () => {
      useAuth.getState().cerrarSesion()
      qc.clear()
    },
  })
}
