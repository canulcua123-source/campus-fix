import { z } from 'zod'

/** GET /analitica/edificios (pipeline de eficiencia por edificio). */
export const analiticaEdificioSchema = z.object({
  edificio: z.string(),
  total: z.number(),
  horas_invertidas: z.number(),
  horas_resolucion_prom: z.number().nullable(),
})
export type AnaliticaEdificio = z.infer<typeof analiticaEdificioSchema>
export const analiticaEdificiosSchema = z.array(analiticaEdificioSchema)

/** GET /analitica/tags (top 10). */
export const analiticaTagSchema = z.object({ tag: z.string(), total: z.number() })
export type AnaliticaTag = z.infer<typeof analiticaTagSchema>
export const analiticaTagsSchema = z.array(analiticaTagSchema)
