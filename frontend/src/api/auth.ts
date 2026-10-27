import { queryOptions } from '@tanstack/react-query'
import { useAuth } from '../auth/store'
import { loginOutSchema, loginSchema, meSchema, type LoginIn } from '../schemas/usuario'
import { api, refrescarSesion, validarEntrada } from './client'
import { claves } from './keys'

/** Login: `credentials: 'include'` para que el navegador guarde la cookie HttpOnly de refresh. */
export function login(datos: LoginIn) {
  return api('/auth/login', {
    method: 'POST',
    credentials: 'include',
    json: validarEntrada(loginSchema, datos),
    schema: loginOutSchema,
  })
}

/** Revoca la familia de refresh y borra la cookie. 204 sin cuerpo. */
export function logout() {
  return api('/auth/logout', { method: 'POST', credentials: 'include' })
}

export const meQuery = () =>
  queryOptions({ queryKey: claves.me, queryFn: ({ signal }) => api('/auth/me', { signal, schema: meSchema }) })

let restauracion: Promise<boolean> | null = null

/**
 * Refresh silencioso al abrir la app: si la cookie de refresh sigue vigente se obtiene un access
 * token nuevo y el perfil (/auth/me) sin pedir credenciales. Mientras corre, `restaurando` es true
 * y RequirePermiso espera en lugar de mandar a /login. Una sola ejecución a la vez.
 */
export function restaurarSesion(): Promise<boolean> {
  const auth = useAuth.getState()
  if (auth.usuario) return Promise.resolve(true)
  if (!restauracion) {
    auth.setRestaurando(true)
    restauracion = (async () => {
      try {
        const token = await refrescarSesion()
        if (!token) return false
        const me = await api('/auth/me', { schema: meSchema })
        const { nombre, rol, permisos, alcance } = me
        if (useAuth.getState().token !== token) return false // otra sesión empezó mientras tanto
        useAuth.getState().iniciarSesion(token, { nombre, rol, permisos, alcance })
        return true
      } catch (e) {
        if (import.meta.env.DEV) console.info('[auth] no fue posible restaurar la sesión', e)
        if (!useAuth.getState().usuario) useAuth.getState().cerrarSesion()
        return false
      } finally {
        useAuth.getState().setRestaurando(false)
        restauracion = null
      }
    })()
  }
  return restauracion
}
