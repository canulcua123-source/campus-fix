import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ConfigIAPatch } from '../../schemas/config'
import { configIaQuery, editarConfigIa } from '../config'
import { claves } from '../keys'

export function useConfigIA() {
  return useQuery(configIaQuery())
}

export function useEditarConfigIA() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (datos: ConfigIAPatch) => editarConfigIa(datos),
    onSuccess: (config) => qc.setQueryData(claves.configIA, config),
  })
}
