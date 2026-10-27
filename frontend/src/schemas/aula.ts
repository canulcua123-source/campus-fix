import { z } from 'zod'

export const ID_AULA_RE = /^[A-Za-z0-9_-]{22}$/

export const aulaResueltaSchema = z.object({
  id_publico: z.string().regex(ID_AULA_RE),
  ubicacion: z.object({
    edificio: z.string().min(1).max(60),
    piso: z.number().int().min(-5).max(50),
    aula: z.string().min(1).max(60),
  }),
})

export type AulaResuelta = z.infer<typeof aulaResueltaSchema>

/** Espejo de EdificioCatalogoOut (GET /aulas). */
export const aulaCatalogoSchema = z.object({
  id_publico: z.string().regex(ID_AULA_RE),
  piso: z.number().int().min(-5).max(50),
  aula: z.string().min(1).max(60),
  activa: z.boolean(),
})

export const edificioCatalogoSchema = z.object({
  edificio: z.string().min(1).max(60),
  total_aulas: z.number().int().min(0),
  activas: z.number().int().min(0),
  pisos: z.array(z.number().int().min(-5).max(50)).max(56),
  aulas: z.array(aulaCatalogoSchema),
})

export const catalogoAulasSchema = z.array(edificioCatalogoSchema)

export type AulaCatalogo = z.infer<typeof aulaCatalogoSchema>
export type EdificioCatalogo = z.infer<typeof edificioCatalogoSchema>

/** Ubicación elegible al reportar (GET /aulas/ubicaciones): solo aulas activas, sin id_publico. */
export const ubicacionAulaSchema = z.object({
  edificio: z.string().min(1).max(60),
  piso: z.number().int().min(-5).max(50),
  aula: z.string().min(1).max(60),
}).strict()
export const ubicacionesAulaSchema = z.array(ubicacionAulaSchema)
export type UbicacionAula = z.infer<typeof ubicacionAulaSchema>
