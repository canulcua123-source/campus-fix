import { z } from 'zod'
import { CATEGORIAS } from './incidencia'

/** Filtros admitidos por FiltrosAnalitica en el backend (solo fechas calendario UTC). */
export type FiltrosAnalitica = {
  desde?: string
  hasta?: string
  categoria?: (typeof CATEGORIAS)[number]
}

/** GET /analitica/resumen (pipeline con $facet). */
export const resumenAnaliticaSchema = z.object({
  abiertas: z.number().int().nonnegative(),
  en_proceso: z.number().int().nonnegative(),
  criticas: z.number().int().nonnegative(),
  resueltas_periodo: z.number().int().nonnegative(),
})
export type ResumenAnalitica = z.infer<typeof resumenAnaliticaSchema>

/** GET /analitica/edificios (solo incidencias resueltas o cerradas). */
export const analiticaEdificioSchema = z.object({
  edificio: z.string().min(1).max(60),
  total: z.number().int().nonnegative(),
  horas_invertidas: z.number().nonnegative().finite(),
  horas_resolucion_prom: z.number().nonnegative().finite().nullable(),
})
export type AnaliticaEdificio = z.infer<typeof analiticaEdificioSchema>
export const analiticaEdificiosSchema = z.array(analiticaEdificioSchema)

/** GET /analitica/tags (ranking hasta diez etiquetas). */
export const analiticaTagSchema = z.object({
  tag: z.string().min(2).max(30),
  total: z.number().int().nonnegative(),
})
export type AnaliticaTag = z.infer<typeof analiticaTagSchema>
export const analiticaTagsSchema = z.array(analiticaTagSchema)
/** GET /analitica/carga-tecnicos (incidencias activas asignadas y horas acumuladas por técnico). */
export const cargaTecnicoSchema = z.object({
  tecnico_id: z.string().regex(/^[0-9a-f]{24}$/),
  incidencias_activas: z.number().int().min(1),
  horas_acumuladas: z.number().nonnegative().finite(),
})
export type CargaTecnico = z.infer<typeof cargaTecnicoSchema>
export const cargaTecnicosSchema = z.array(cargaTecnicoSchema)

/** GET /analitica/tendencia (conteo mensual UTC por categoría, por fecha de creación). */
export const tendenciaMensualSchema = z.object({
  periodo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  categoria: z.enum(CATEGORIAS),
  total: z.number().int().min(1),
})
export type TendenciaMensual = z.infer<typeof tendenciaMensualSchema>
export const tendenciaSchema = z.array(tendenciaMensualSchema)

/** GET /analitica/aulas-cronicas (≥ 3 incidencias en los últimos 30 días, intersectado con los filtros). */
export const aulaCronicaSchema = z.object({
  edificio: z.string().min(1).max(60),
  piso: z.number().int().min(-5).max(50).optional(),
  aula: z.string().min(1).max(60),
  total: z.number().int().min(3),
})
export type AulaCronica = z.infer<typeof aulaCronicaSchema>
export const aulasCronicasSchema = z.array(aulaCronicaSchema)
