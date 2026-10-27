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

const textoAula = (campo: string) =>
  z.string({ error: `Escribe ${campo}` }).trim().min(1, `Escribe ${campo}`).max(60, 'Máximo 60 caracteres')

/** Espejo de AulaIn (POST /aulas): el `id_publico` lo genera el servidor. */
export const aulaInSchema = z.strictObject({
  edificio: textoAula('el edificio'),
  piso: z.number({ error: 'Escribe el piso como número entero' })
    .int('Escribe el piso como número entero')
    .min(-5, 'El piso mínimo es -5 (sótano)')
    .max(50, 'El piso máximo es 50'),
  aula: textoAula('el nombre del aula'),
  activa: z.boolean(),
})
export type AulaIn = z.infer<typeof aulaInSchema>

/** Espejo de AulaPatch (PATCH /aulas/{id_publico}): al menos un campo. */
export const aulaPatchSchema = aulaInSchema.partial().refine((v) => Object.keys(v).length > 0, 'Indica al menos un campo a modificar')
export type AulaPatch = z.infer<typeof aulaPatchSchema>

/** Espejo de AulaOut (respuesta de POST/PATCH /aulas). */
export const aulaOutSchema = z.strictObject({
  id_publico: z.string().regex(ID_AULA_RE),
  edificio: z.string().min(1).max(60),
  piso: z.number().int().min(-5).max(50),
  aula: z.string().min(1).max(60),
  activa: z.boolean(),
})
export type AulaOut = z.infer<typeof aulaOutSchema>
