import { queryOptions } from '@tanstack/react-query'
import { aulaResueltaSchema, catalogoAulasSchema, ubicacionesAulaSchema } from '../schemas/aula'
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
