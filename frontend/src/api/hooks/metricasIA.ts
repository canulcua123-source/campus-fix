import { useQuery } from '@tanstack/react-query'
import type { FiltrosMetricasIA } from '../../schemas/metricasIA'
import { metricasIAQuery } from '../metricasIA'

export function useMetricasIA(filtros: FiltrosMetricasIA = {}) {
  return useQuery(metricasIAQuery(filtros))
}
