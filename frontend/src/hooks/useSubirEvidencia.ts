import { useMutation, useQueryClient } from '@tanstack/react-query'
import { subirEvidencia, type SubidaEvidencia } from '../api/evidencias'
import { claves } from '../api/keys'

export interface SubidaConIncidencia extends SubidaEvidencia {
  incidenciaId: string
}

export function useSubirEvidencia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ incidenciaId, ...subida }: SubidaConIncidencia) => subirEvidencia(incidenciaId, subida),
    onSuccess: (_resultado, { incidenciaId }) => qc.invalidateQueries({ queryKey: claves.incidencia(incidenciaId) }),
  })
}
