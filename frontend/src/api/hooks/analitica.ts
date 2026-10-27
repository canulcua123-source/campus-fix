import { useQuery } from '@tanstack/react-query'
import type { FiltrosAnalitica } from '../../schemas/analitica'
import {
  analiticaAulasCronicasQuery, analiticaEdificiosQuery, analiticaResumenQuery, analiticaTagsQuery, analiticaTendenciaQuery,
  cargaTecnicosQuery,
} from '../analitica'

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
/** Carga activa por técnico (GET /analitica/carga-tecnicos); el backend aplica el alcance. */
export function useCargaTecnicos(filtros: FiltrosAnalitica = {}) {
  return useQuery(cargaTecnicosQuery(filtros))
}

export function useAnaliticaTendencia(filtros: FiltrosAnalitica = {}) {
  return useQuery(analiticaTendenciaQuery(filtros))
}

export function useAulasCronicas(filtros: FiltrosAnalitica = {}) {
  return useQuery(analiticaAulasCronicasQuery(filtros))
}
