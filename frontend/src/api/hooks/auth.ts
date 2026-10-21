import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/store'
import { login, meQuery } from '../auth'

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

/** Cierra sesión y limpia la caché (FB-06). */
export function useLogout() {
  const qc = useQueryClient()
  return () => {
    useAuth.getState().cerrarSesion()
    qc.clear()
  }
}
