import { queryOptions } from '@tanstack/react-query'
import {
  analiticaEdificiosSchema,
  analiticaTagsSchema,
  resumenAnaliticaSchema,
  type FiltrosAnalitica,
} from '../schemas/analitica'
import { api } from './client'
import { claves, limpiarFiltrosAnalitica } from './keys'

/** El backend aplica filtro_alcance(usuario) en los tres endpoints: nunca enviar áreas del cliente. */
export const analiticaResumenQuery = (filtros: FiltrosAnalitica = {}) =>
  queryOptions({
    queryKey: claves.resumenFiltrado(filtros),
    queryFn: ({ signal }) => api('/analitica/resumen', {
      signal, params: limpiarFiltrosAnalitica(filtros), schema: resumenAnaliticaSchema,
    }),
    staleTime: 60_000,
  })

export const analiticaEdificiosQuery = (filtros: FiltrosAnalitica = {}) =>
  queryOptions({
    queryKey: claves.edificiosFiltrados(filtros),
    queryFn: ({ signal }) => api('/analitica/edificios', {
      signal, params: limpiarFiltrosAnalitica(filtros), schema: analiticaEdificiosSchema,
    }),
    staleTime: 60_000,
  })

export const analiticaTagsQuery = (filtros: FiltrosAnalitica = {}) =>
  queryOptions({
    queryKey: claves.tagsFiltrados(filtros),
    queryFn: ({ signal }) => api('/analitica/tags', {
      signal, params: limpiarFiltrosAnalitica(filtros), schema: analiticaTagsSchema,
    }),
    staleTime: 60_000,
  })