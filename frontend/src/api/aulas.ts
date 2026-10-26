import { queryOptions } from '@tanstack/react-query'
import { aulaResueltaSchema } from '../schemas/aula'
import { api } from './client'
import { claves } from './keys'

export const aulaQuery = (id: string) => queryOptions({
  queryKey: claves.aula(id),
  queryFn: ({ signal }) => api(`/aulas/${encodeURIComponent(id)}`, { signal, schema: aulaResueltaSchema }),
  staleTime: 24 * 60 * 60 * 1000,
  retry: false,
})
