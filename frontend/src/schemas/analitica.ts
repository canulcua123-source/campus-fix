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