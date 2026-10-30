import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CategoriaIn, CategoriaPatch } from '../../schemas/catalogos'
import type { RolIn, RolPatch, UsuarioIn, UsuarioPatch } from '../../schemas/usuario'
import { categoriasQuery, crearCategoria, editarCategoria } from '../catalogos'
import { invalidarAdmin } from '../frescura'
import { claves } from '../keys'
import { crearRol, crearUsuario, editarRol, editarUsuario, eliminarRol, rolesQuery, tecnicosQuery, usuariosQuery } from '../usuarios'

export function useCategorias() {
  return useQuery(categoriasQuery())
}

export function useCrearCategoria() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (datos: CategoriaIn) => crearCategoria(datos),
    onSuccess: () => invalidarAdmin(qc, claves.categorias, claves.usuarios),
  })
}

export function useEditarCategoria() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ clave, datos }: { clave: string; datos: CategoriaPatch }) => editarCategoria(clave, datos),
    onSuccess: () => invalidarAdmin(qc, claves.categorias, claves.usuarios),
  })
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
    onSuccess: () => invalidarAdmin(qc, claves.usuarios, claves.me, claves.analitica),
  })
}

export function useEditarUsuario() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, datos }: { id: string; datos: UsuarioPatch }) => editarUsuario(id, datos),
    onSuccess: () => invalidarAdmin(qc, claves.usuarios, claves.me, claves.analitica),
  })
}

export function useRoles() {
  return useQuery(rolesQuery())
}

export function useCrearRol() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (datos: RolIn) => crearRol(datos),
    onSuccess: () => invalidarAdmin(qc, claves.roles, claves.usuarios, claves.me),
  })
}

export function useEditarRol() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, datos }: { id: string; datos: RolPatch }) => editarRol(id, datos),
    onSuccess: () => invalidarAdmin(qc, claves.roles, claves.usuarios, claves.me),
  })
}

export function useEliminarRol() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => eliminarRol(id),
    onSuccess: () => invalidarAdmin(qc, claves.roles, claves.usuarios, claves.me),
  })
}
