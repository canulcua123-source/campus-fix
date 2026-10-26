import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AsignacionIn, FiltrosIncidencias, IncidenciaIn, SeguimientoIn, TagsIn } from '../../schemas/incidencia'
import { ApiError } from '../client'
import { subirEvidencia, urlEvidenciaQuery, type SubidaEvidencia } from '../evidencias'
import {
  agregarTags, asignar, buscarQuery, crearIncidencia, incidenciaQuery, incidenciasQuery, quitarTags, registrarSeguimiento,
  retirarIncidencia,
} from '../incidencias'
import { claves } from '../keys'

export function useIncidencias(filtros: FiltrosIncidencias = {}) {
  return useQuery(incidenciasQuery(filtros))
}

export function useIncidencia(id: string) {
  return useQuery(incidenciaQuery(id))
}

/** Búsqueda de texto; no consulta hasta tener 2+ caracteres. Debounce en la página. */
export function useBuscar(q: string) {
  return useQuery(buscarQuery(q))
}

export function useCrearIncidencia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (datos: IncidenciaIn) => crearIncidencia(datos),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: claves.incidencias })
      qc.invalidateQueries({ queryKey: claves.analitica })
    },
  })
}

const esConflicto = (e: unknown) => e instanceof ApiError && e.status === 409

/** Invalida detalle, listas y analítica de una incidencia. */
function useInvalidarIncidencia(id: string) {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: claves.incidencia(id) })
    qc.invalidateQueries({ queryKey: claves.incidencias })
    qc.invalidateQueries({ queryKey: claves.analitica })
  }
}

export function useSeguimiento(id: string) {
  const invalidar = useInvalidarIncidencia(id)
  return useMutation({
    mutationFn: (datos: SeguimientoIn) => registrarSeguimiento(id, datos),
    onSuccess: invalidar,
    onError: (e) => esConflicto(e) && invalidar(), // 409: el estado cambió; se refrescan los datos
  })
}

export function useAsignar(id: string) {
  const invalidar = useInvalidarIncidencia(id)
  return useMutation({
    mutationFn: (datos: AsignacionIn) => asignar(id, datos),
    onSuccess: invalidar,
    onError: (e) => esConflicto(e) && invalidar(),
  })
}

export function useRetirar(id: string) {
  const qc = useQueryClient()
  const invalidar = useInvalidarIncidencia(id)
  return useMutation({
    mutationFn: () => retirarIncidencia(id),
    onSuccess: () => {
      qc.setQueryData(claves.incidencia(id), (actual: unknown) => {
        if (!actual || typeof actual !== 'object') return actual
        return { ...actual, estado: 'retirada', puede_retirar: false }
      })
      invalidar()
    },
    onError: (e) => esConflicto(e) && invalidar(),
  })
}

/** Agregar y quitar tags: `const { agregar, quitar } = useTags(id); agregar.mutate({ tags: ['wifi'] })`. */
export function useTags(id: string) {
  const qc = useQueryClient()
  const onSuccess = () => {
    qc.invalidateQueries({ queryKey: claves.incidencia(id) })
    qc.invalidateQueries({ queryKey: claves.incidencias })
    qc.invalidateQueries({ queryKey: claves.analiticaTags })
  }
  const agregar = useMutation({ mutationFn: (datos: TagsIn) => agregarTags(id, datos), onSuccess })
  const quitar = useMutation({ mutationFn: (datos: TagsIn) => quitarTags(id, datos), onSuccess })
  return { agregar, quitar }
}

/** Sube una evidencia (firma → PUT → registro). `mutate({ archivo, onProgreso })`. */
export function useEvidencia(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (subida: SubidaEvidencia) => subirEvidencia(id, subida),
    onSettled: () => qc.invalidateQueries({ queryKey: claves.incidencia(id) }),
  })
}

/** URL de lectura de una evidencia; pásale `enabled` al abrir el visor (caduca en 5 min, no se cachea). */
export function useUrlEvidencia(id: string, evidenciaId: string, enabled = true) {
  return useQuery({ ...urlEvidenciaQuery(id, evidenciaId), enabled })
}
