import { queryOptions } from '@tanstack/react-query'
import {
  analiticaEdificiosSchema,
  analiticaTagsSchema,
  aulasCronicasSchema,
  cargaTecnicosSchema,
  resumenAnaliticaSchema,
  tendenciaSchema,
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

export const cargaTecnicosQuery = (filtros: FiltrosAnalitica = {}) =>
  queryOptions({
    queryKey: claves.cargaTecnicos(filtros),
    queryFn: ({ signal }) => api('/analitica/carga-tecnicos', {
      signal, params: limpiarFiltrosAnalitica(filtros), schema: cargaTecnicosSchema,
    }),
    staleTime: 60_000,
  })

export const analiticaTendenciaQuery = (filtros: FiltrosAnalitica = {}) =>
  queryOptions({
    queryKey: ['analitica', 'tendencia', limpiarFiltrosAnalitica(filtros)] as const,
    queryFn: ({ signal }) => api('/analitica/tendencia', {
      signal, params: limpiarFiltrosAnalitica(filtros), schema: tendenciaSchema,
    }),
    staleTime: 60_000,
  })

/** Ventana fija de 30 días (UTC) que el backend intersecta con desde/hasta. */
export const analiticaAulasCronicasQuery = (filtros: FiltrosAnalitica = {}) =>
  queryOptions({
    queryKey: ['analitica', 'aulas-cronicas', limpiarFiltrosAnalitica(filtros)] as const,
    queryFn: ({ signal }) => api('/analitica/aulas-cronicas', {
      signal, params: limpiarFiltrosAnalitica(filtros), schema: aulasCronicasSchema,
    }),
    staleTime: 60_000,
  })
