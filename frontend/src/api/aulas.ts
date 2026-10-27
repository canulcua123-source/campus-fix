import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  aulaOutSchema, aulaResueltaSchema, catalogoAulasSchema, ubicacionesAulaSchema, type AulaIn, type AulaPatch,
} from '../schemas/aula'
import { api } from './client'
import { claves } from './keys'

export const aulaQuery = (id: string) => queryOptions({
  queryKey: claves.aula(id),
  queryFn: ({ signal }) => api(`/aulas/${encodeURIComponent(id)}`, { signal, schema: aulaResueltaSchema }),
  staleTime: 24 * 60 * 60 * 1000,
  retry: false,
})

/** Catálogo de aulas agrupado por edificio (requiere usuarios:gestionar). */
export const catalogoAulasQuery = () => queryOptions({
  queryKey: claves.catalogoAulas,
  queryFn: ({ signal }) => api('/aulas', { signal, schema: catalogoAulasSchema }),
  staleTime: 5 * 60 * 1000,
})

/** Aulas activas para elegir la ubicación al reportar (requiere incidencias:crear). */
export const ubicacionesAulaQuery = () => queryOptions({
  queryKey: claves.ubicacionesAula,
  queryFn: ({ signal }) => api('/aulas/ubicaciones', { signal, schema: ubicacionesAulaSchema }),
  staleTime: 60 * 60 * 1000,
})

/** POST /aulas (requiere usuarios:gestionar): 409 si ya existe esa ubicación. */
export const crearAula = (datos: AulaIn) =>
  api('/aulas', { method: 'POST', json: datos, schema: aulaOutSchema })

/** PATCH /aulas/{id_publico}: edición parcial; el id del QR no cambia. */
export const editarAula = (id: string, datos: AulaPatch) =>
  api(`/aulas/${encodeURIComponent(id)}`, { method: 'PATCH', json: datos, schema: aulaOutSchema })

function useInvalidarAulas() {
  const qc = useQueryClient()
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: claves.catalogoAulas }),
    qc.invalidateQueries({ queryKey: claves.ubicacionesAula }),
  ])
}

export function useCrearAula() {
  const invalidar = useInvalidarAulas()
  return useMutation({ mutationFn: crearAula, onSuccess: invalidar })
}

export function useEditarAula() {
  const invalidar = useInvalidarAulas()
  return useMutation({
    mutationFn: ({ id, datos }: { id: string; datos: AulaPatch }) => editarAula(id, datos),
    onSuccess: invalidar,
  })
}
