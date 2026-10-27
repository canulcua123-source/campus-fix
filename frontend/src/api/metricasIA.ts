import { queryOptions } from '@tanstack/react-query'
import { metricasIASchema, type FiltrosMetricasIA } from '../schemas/metricasIA'
import { api } from './client'
import { claves, limpiarFiltrosMetricasIA } from './keys'

export const metricasIAQuery = (filtros: FiltrosMetricasIA = {}) =>
  queryOptions({
    queryKey: claves.metricasIAFiltradas(filtros),
    queryFn: ({ signal }) => api('/analitica/ia', {
      signal,
      params: limpiarFiltrosMetricasIA(filtros),
      schema: metricasIASchema,
    }),
    staleTime: 60_000,
  })
