import { queryOptions } from '@tanstack/react-query'
import {
  rolInSchema, rolSchema, rolesSchema, usuarioInSchema, usuarioPatchSchema, usuarioSchema, usuariosSchema,
  type Rol, type RolIn, type UsuarioApi, type UsuarioIn, type UsuarioPatch,
} from '../schemas/usuario'
import { api, validarEntrada } from './client'
import { claves } from './keys'

/** Política visual de contraseña para el alta; la API conserva su validación autoritativa. */
export function errorFortalezaPassword(password: string): string | null {
  if (password.length < 10) return 'Usa al menos 10 caracteres'
  if (password.length > 128) return 'Máximo 128 caracteres'
  if (!/[a-záéíóúñ]/.test(password) || !/[A-ZÁÉÍÓÚÑ]/.test(password)) return 'Incluye mayúsculas y minúsculas'
  if (!/\d/.test(password)) return 'Incluye al menos un número'
  if (!/[^\p{L}\p{N}\s]/u.test(password)) return 'Incluye al menos un símbolo'
  return null
}

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

/** Selectores de asignación: excluir cuentas desactivadas y roles sin permiso de seguimiento. */
export function tecnicosActivos(usuarios: UsuarioApi[], roles: Rol[]): UsuarioApi[] {
  const rolesTecnicos = new Set(roles.filter((rol) => rol.permisos.includes('seguimiento:registrar')).map((rol) => rol.clave))
  return usuarios.filter((usuario) => usuario.activo !== false && rolesTecnicos.has(usuario.rol))
}
