import { z } from 'zod'

/** Espejo de backend/app/schemas/config.py para GET/PATCH /config/ia. */
export const configIaSchema = z.strictObject({
  habilitada: z.boolean(),
  limite_diario_usuario: z.number().int().min(1).max(1000),
  limite_diario_global: z.number().int().min(1).max(100000),
})
export type ConfigIA = z.infer<typeof configIaSchema>

export const configIaPatchSchema = configIaSchema.partial().refine((v) => Object.keys(v).length > 0, 'Envía al menos un campo')
export type ConfigIAPatch = z.infer<typeof configIaPatchSchema>
