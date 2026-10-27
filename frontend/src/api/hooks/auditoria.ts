import { useQuery } from '@tanstack/react-query'
import type { FiltrosAuditoria } from '../../schemas/auditoria'
import { auditoriaQuery } from '../auditoria'

export function useAuditoria(filtros: FiltrosAuditoria = {}) {
  return useQuery(auditoriaQuery(filtros))
}
