import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import { paginaAuditoriaSchema, type FiltrosAuditoria } from '../schemas/auditoria'
import { api } from './client'
import { claves } from './keys'

export const auditoriaQuery = (filtros: FiltrosAuditoria = {}) =>
  queryOptions({
    queryKey: claves.auditoriaFiltrada(filtros),
    queryFn: ({ signal }) => api('/auditoria', { signal, params: filtros, schema: paginaAuditoriaSchema }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
