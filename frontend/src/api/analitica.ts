import { queryOptions } from '@tanstack/react-query'
import { analiticaEdificiosSchema, analiticaTagsSchema } from '../schemas/analitica'
import { api } from './client'
import { claves } from './keys'

export const analiticaEdificiosQuery = () =>
  queryOptions({
    queryKey: claves.analiticaEdificios,
    queryFn: ({ signal }) => api('/analitica/edificios', { signal, schema: analiticaEdificiosSchema }),
    staleTime: 60_000,
  })

export const analiticaTagsQuery = () =>
  queryOptions({
    queryKey: claves.analiticaTags,
    queryFn: ({ signal }) => api('/analitica/tags', { signal, schema: analiticaTagsSchema }),
    staleTime: 60_000,
  })
