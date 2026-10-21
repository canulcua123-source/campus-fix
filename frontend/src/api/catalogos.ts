import { queryOptions } from '@tanstack/react-query'
import { categoriasSchema } from '../schemas/catalogos'
import { api } from './client'
import { claves } from './keys'

export const categoriasQuery = () =>
  queryOptions({
    queryKey: claves.categorias,
    queryFn: ({ signal }) => api('/categorias', { signal, schema: categoriasSchema }),
    staleTime: 10 * 60_000, // catálogo: casi no cambia
  })
