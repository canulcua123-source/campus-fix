import { queryOptions } from '@tanstack/react-query'
import {
  rolInSchema, rolSchema, rolesSchema, usuarioInSchema, usuarioPatchSchema, usuarioSchema, usuariosSchema,
  type RolIn, type UsuarioIn, type UsuarioPatch,
} from '../schemas/usuario'
import { api, validarEntrada } from './client'
import { claves } from './keys'

export const usuariosQuery = () =>
  queryOptions({
    queryKey: claves.usuarios,
    queryFn: ({ signal }) => api('/usuarios', { signal, schema: usuariosSchema }),
    refetchOnWindowFocus: true,
  })

export function crearUsuario(datos: UsuarioIn) {
  return api('/usuarios', { method: 'POST', json: validarEntrada(usuarioInSchema, datos), schema: usuarioSchema })
}

export function editarUsuario(id: string, datos: UsuarioPatch) {
  return api(`/usuarios/${encodeURIComponent(id)}`, { method: 'PATCH', json: validarEntrada(usuarioPatchSchema, datos), schema: usuarioSchema })
}

export const rolesQuery = () =>
  queryOptions({
    queryKey: claves.roles,
    queryFn: ({ signal }) => api('/roles', { signal, schema: rolesSchema }),
    refetchOnWindowFocus: true,
  })

export function crearRol(datos: RolIn) {
  return api('/roles', { method: 'POST', json: validarEntrada(rolInSchema, datos), schema: rolSchema })
}
