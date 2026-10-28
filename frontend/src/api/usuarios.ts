import { queryOptions } from '@tanstack/react-query'
import {
  okSchema, rolInSchema, rolPatchSchema, rolSchema, rolesSchema, tecnicosSchema, usuarioInSchema, usuarioPatchSchema, usuarioSchema, usuariosSchema,
  type AlcanceRol, type Rol, type RolIn, type RolPatch, type UsuarioApi, type UsuarioIn, type UsuarioPatch,
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

/** Técnicos activos que el coordinador puede asignar; `area` = categoría de la incidencia. */
export const tecnicosQuery = (area?: string) =>
  queryOptions({
    queryKey: claves.tecnicos(area),
    queryFn: ({ signal }) => api('/usuarios/tecnicos', { signal, params: { area }, schema: tecnicosSchema }),
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

export function editarRol(id: string, datos: RolPatch) {
  return api(`/roles/${encodeURIComponent(id)}`, { method: 'PATCH', json: validarEntrada(rolPatchSchema, datos), schema: rolSchema })
}

export function eliminarRol(id: string) {
  return api(`/roles/${encodeURIComponent(id)}`, { method: 'DELETE', schema: okSchema })
}

/**
 * Espejo de `puede_otorgar` (backend/app/core/security.py) para roles: nadie otorga permisos que no
 * tiene ni un alcance mayor al suyo. Solo oculta/deshabilita acciones; la API decide (403).
 */
export function puedeOtorgar(actor: { permisos: readonly string[]; alcance: AlcanceRol }, permisos: readonly string[], alcance: AlcanceRol): boolean {
  if (!permisos.every((p) => actor.permisos.includes(p))) return false
  if (actor.alcance === 'global') return true
  return alcance === 'propio' || alcance === actor.alcance
}

/**
 * Espejo de `_es_rol_privilegiado` (backend/app/routers/usuarios.py): roles que administran el sistema completo.
 * Solo el superadmin (`sistema:administrar`) los ve, crea, edita o asigna.
 */
export function esRolPrivilegiado(rol: { clave: string; permisos: readonly string[]; alcance: AlcanceRol }): boolean {
  return rol.clave === 'admin' || rol.clave === 'superadmin' || rol.permisos.includes('sistema:administrar') ||
    (rol.permisos.includes('usuarios:gestionar') && rol.alcance === 'global')
}

/** Selectores de asignación: excluir cuentas desactivadas y roles sin permiso de seguimiento. */
export function tecnicosActivos(usuarios: UsuarioApi[], roles: Rol[]): UsuarioApi[] {
  const rolesTecnicos = new Set(roles.filter((rol) => rol.permisos.includes('seguimiento:registrar')).map((rol) => rol.clave))
  return usuarios.filter((usuario) => usuario.activo !== false && rolesTecnicos.has(usuario.rol))
}
