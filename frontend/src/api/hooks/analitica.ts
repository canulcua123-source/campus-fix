import { useQuery } from '@tanstack/react-query'
import type { FiltrosAnalitica } from '../../schemas/analitica'
import { analiticaEdificiosQuery, analiticaResumenQuery, analiticaTagsQuery } from '../analitica'

export function useAnaliticaResumen(filtros: FiltrosAnalitica = {}) {
  return useQuery(analiticaResumenQuery(filtros))
}

export function useAnaliticaEdificios(filtros: FiltrosAnalitica = {}) {
  return useQuery(analiticaEdificiosQuery(filtros))
}

export function useAnaliticaTags(filtros: FiltrosAnalitica = {}) {
  return useQuery(analiticaTagsQuery(filtros))
}

/** Las tres consultas comparten exactamente los filtros aplicados. */
export function useAnalitica(filtros: FiltrosAnalitica = {}) {
  const resumen = useAnaliticaResumen(filtros)
  const edificios = useAnaliticaEdificios(filtros)
  const tags = useAnaliticaTags(filtros)
  return { resumen, edificios, tags }
}