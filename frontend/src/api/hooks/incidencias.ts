import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AsignacionIn, ComentarioReportanteIn, ConfirmacionIn, FiltrosIncidencias, IncidenciaIn, PrioridadIn, SeguimientoIn, TagsIn,
} from '../../schemas/incidencia'
import { ApiError } from '../client'
import { subirEvidencia, urlEvidenciaQuery, type SubidaEvidencia } from '../evidencias'
import {
  agregarTags, asignar, buscarQuery, cambiarPrioridad, comentarEnEspera, confirmarSolucion, crearIncidencia, incidenciaQuery, incidenciasQuery, quitarTags, registrarSeguimiento,
  retirarIncidencia, tomarIncidencia,
} from '../incidencias'
import { invalidarIncidencia } from '../frescura'
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
    onSuccess: () => invalidarIncidencia(qc),
  })
}

const esConflicto = (e: unknown) => e instanceof ApiError && e.status === 409

/** Invalida detalle, listas, analítica y Centro de control de una incidencia (ver `invalidarIncidencia`). */
function useInvalidarIncidencia(id: string) {
  const qc = useQueryClient()
  return () => invalidarIncidencia(qc, id)
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

export function usePrioridad(id: string) {
  const invalidar = useInvalidarIncidencia(id)
  return useMutation({
    mutationFn: (datos: PrioridadIn) => cambiarPrioridad(id, datos),
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
      return invalidar()
    },
    onError: (e) => esConflicto(e) && invalidar(),
  })
}

/** Reportante: confirma (→ cerrada) o reabre (→ abierta) una incidencia resuelta. */
export function useConfirmacion(id: string) {
  const invalidar = useInvalidarIncidencia(id)
  return useMutation({
    mutationFn: (datos: ConfirmacionIn) => confirmarSolucion(id, datos),
    onSuccess: invalidar,
    onError: (e) => esConflicto(e) && invalidar(),
  })
}

/** Reportante: agrega información mientras la incidencia está en espera (no cambia estado). */
export function useComentarioReportante(id: string) {
  const invalidar = useInvalidarIncidencia(id)
  return useMutation({
    mutationFn: (datos: ComentarioReportanteIn) => comentarEnEspera(id, datos),
    onSuccess: invalidar,
    onError: (e) => esConflicto(e) && invalidar(),
  })
}

/** Técnico: se autoasigna una incidencia sin técnico. `useTomar().mutate(id)`; 409 = ya la tomó alguien más. */
export function useTomar() {
  const qc = useQueryClient()
  const invalidar = (id: string) => invalidarIncidencia(qc, id)
  return useMutation({
    mutationFn: (id: string) => tomarIncidencia(id),
    onSuccess: (_r, id) => invalidar(id),
    onError: (e, id) => esConflicto(e) && invalidar(id),
  })
}

/** Agregar y quitar tags: `const { agregar, quitar } = useTags(id); agregar.mutate({ tags: ['wifi'] })`. */
export function useTags(id: string) {
  const invalidar = useInvalidarIncidencia(id)
  const onSuccess = () => invalidar()
  const agregar = useMutation({ mutationFn: (datos: TagsIn) => agregarTags(id, datos), onSuccess })
  const quitar = useMutation({ mutationFn: (datos: TagsIn) => quitarTags(id, datos), onSuccess })
  return { agregar, quitar }
}

/**
 * Sube una evidencia (firma → PUT → registro) con reintento del PUT y del registro.
 * `useEvidencia(id).mutate({ archivo })`; si el id aún no existe (p. ej. se acaba de crear la incidencia) se pasa
 * en la llamada: `useEvidencia().mutateAsync({ incidenciaId, archivo, reanudar })`. Reutiliza el mismo `reanudar`
 * al reintentar para repetir solo el paso que falló.
 */
export function useEvidencia(id?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ incidenciaId, ...subida }: SubidaEvidencia & { incidenciaId?: string }) => {
      const destino = incidenciaId ?? id
      if (!destino) throw new Error('Falta la incidencia a la que se adjunta la evidencia')
      return subirEvidencia(destino, subida)
    },
    onSettled: (_datos, _error, variables) => {
      const destino = variables.incidenciaId ?? id
      // Sin esperar: no retrasa el flujo de «Reportar» (varias fotos seguidas).
      if (destino) void invalidarIncidencia(qc, destino)
    },
  })
}

/** URL de lectura de una evidencia; pásale `enabled` al abrir el visor (caduca en 5 min, no se cachea). */
export function useUrlEvidencia(id: string, evidenciaId: string, enabled = true) {
  return useQuery({ ...urlEvidenciaQuery(id, evidenciaId), enabled })
}
