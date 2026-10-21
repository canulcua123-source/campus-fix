import { useQuery } from '@tanstack/react-query'
import { analiticaEdificiosQuery, analiticaTagsQuery } from '../analitica'

export function useAnaliticaEdificios() {
  return useQuery(analiticaEdificiosQuery())
}

export function useAnaliticaTags() {
  return useQuery(analiticaTagsQuery())
}

/** Ambas consultas del dashboard. */
export function useAnalitica() {
  return { edificios: useAnaliticaEdificios(), tags: useAnaliticaTags() }
}
