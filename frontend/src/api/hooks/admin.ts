import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { RolIn, UsuarioIn, UsuarioPatch } from '../../schemas/usuario'
import { categoriasQuery } from '../catalogos'
import { claves } from '../keys'
import { crearRol, crearUsuario, editarUsuario, rolesQuery, tecnicosQuery, usuariosQuery } from '../usuarios'

export function useCategorias() {
  return useQuery(categoriasQuery())
}

export function useUsuarios() {
  return useQuery(usuariosQuery())
}

/** Técnicos asignables (GET /usuarios/tecnicos), opcionalmente de un área. */
export function useTecnicos(area?: string, enabled = true) {
  return useQuery({ ...tecnicosQuery(area), enabled })
}

export function useCrearUsuario() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (datos: UsuarioIn) => crearUsuario(datos),
    onSuccess: () => qc.invalidateQueries({ queryKey: claves.usuarios }),
  })
}

export function useEditarUsuario() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, datos }: { id: string; datos: UsuarioPatch }) => editarUsuario(id, datos),
    onSuccess: () => qc.invalidateQueries({ queryKey: claves.usuarios }),
  })
}

export function useRoles() {
  return useQuery(rolesQuery())
}

export function useCrearRol() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (datos: RolIn) => crearRol(datos),
    onSuccess: () => qc.invalidateQueries({ queryKey: claves.roles }),
  })
}
