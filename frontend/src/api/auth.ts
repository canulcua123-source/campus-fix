import { queryOptions } from '@tanstack/react-query'
import { loginOutSchema, loginSchema, meSchema, type LoginIn } from '../schemas/usuario'
import { api, validarEntrada } from './client'
import { claves } from './keys'

export function login(datos: LoginIn) {
  return api('/auth/login', { method: 'POST', json: validarEntrada(loginSchema, datos), schema: loginOutSchema })
}

export const meQuery = () =>
  queryOptions({ queryKey: claves.me, queryFn: ({ signal }) => api('/auth/me', { signal, schema: meSchema }) })
