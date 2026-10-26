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
