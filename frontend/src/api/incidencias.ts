import { queryOptions } from '@tanstack/react-query'
import {
  asignacionOutSchema, asignacionSchema, busquedaSchema, comentarioReportanteSchema, confirmacionSchema, incidenciaCreadaSchema, incidenciaDetalleSchema, incidenciaListaSchema,
  incidenciaSchema, okSchema, prioridadOutSchema, prioridadSchema, seguimientoOutSchema, seguimientoSchema, tagsSchema, tomarOutSchema,
  type AsignacionIn, type ComentarioReportanteIn, type ConfirmacionIn, type FiltrosIncidencias, type IncidenciaIn, type PrioridadIn, type SeguimientoIn, type TagsIn,
} from '../schemas/incidencia'
import { api, validarEntrada } from './client'
import { refrescoOperativo } from './frescura'
import { claves, limpiarFiltros } from './keys'

const ruta = (id: string) => `/incidencias/${encodeURIComponent(id)}`

export const incidenciasQuery = (filtros: FiltrosIncidencias = {}) =>
  queryOptions({
    queryKey: claves.listaIncidencias(filtros),
    queryFn: ({ signal }) => api('/incidencias', { signal, params: limpiarFiltros(filtros), schema: incidenciaListaSchema }),
    // Bandeja, Mis reportes, Tablero, Inicio, Incidencias: ven cambios de otros usuarios sin recargar.
    ...refrescoOperativo,
  })

export const buscarQuery = (q: string) =>
  queryOptions({
    queryKey: claves.buscar(q),
    queryFn: ({ signal }) => api('/incidencias/buscar', { signal, params: { q: q.trim() }, schema: incidenciaListaSchema }),
    enabled: busquedaSchema.safeParse(q).success,
  })

export const incidenciaQuery = (id: string) =>
  queryOptions({
    queryKey: claves.incidencia(id),
    queryFn: ({ signal }) => api(ruta(id), { signal, schema: incidenciaDetalleSchema }),
    enabled: Boolean(id),
    ...refrescoOperativo, // detalle o panel abierto: estado, asignación e historial al día
  })

export function crearIncidencia(datos: IncidenciaIn) {
  return api('/incidencias', { method: 'POST', json: validarEntrada(incidenciaSchema, datos), schema: incidenciaCreadaSchema })
}

export function registrarSeguimiento(id: string, datos: SeguimientoIn) {
  return api(`${ruta(id)}/seguimiento`, { method: 'PATCH', json: validarEntrada(seguimientoSchema, datos), schema: seguimientoOutSchema })
}

export function retirarIncidencia(id: string) {
  return api(`${ruta(id)}/retirar`, { method: 'POST', schema: seguimientoOutSchema })
}

export function agregarTags(id: string, datos: TagsIn) {
  return api(`${ruta(id)}/tags`, { method: 'POST', json: validarEntrada(tagsSchema, datos), schema: okSchema })
}

export function quitarTags(id: string, datos: TagsIn) {
  return api(`${ruta(id)}/tags`, { method: 'DELETE', json: validarEntrada(tagsSchema, datos), schema: okSchema })
}

export function asignar(id: string, datos: AsignacionIn) {
  return api(`${ruta(id)}/asignacion`, { method: 'PATCH', json: validarEntrada(asignacionSchema, datos), schema: asignacionOutSchema })
}

export function cambiarPrioridad(id: string, datos: PrioridadIn) {
  return api(`${ruta(id)}/prioridad`, { method: 'PATCH', json: validarEntrada(prioridadSchema, datos), schema: prioridadOutSchema })
}

export function confirmarSolucion(id: string, datos: ConfirmacionIn) {
  return api(`${ruta(id)}/confirmacion`, { method: 'POST', json: validarEntrada(confirmacionSchema, datos), schema: seguimientoOutSchema })
}

export function comentarEnEspera(id: string, datos: ComentarioReportanteIn) {
  return api(`${ruta(id)}/comentarios`, { method: 'POST', json: validarEntrada(comentarioReportanteSchema, datos), schema: seguimientoOutSchema })
}

export function tomarIncidencia(id: string) {
  return api(`${ruta(id)}/tomar`, { method: 'POST', schema: tomarOutSchema })
}
