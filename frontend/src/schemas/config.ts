import { z } from 'zod'

export const CATEGORIAS_AGENTICAS = ['computo_redes', 'infraestructura', 'academico'] as const

/** Espejo de backend/app/schemas/config.py para GET/PATCH /config/ia. */
export const configIaSchema = z.strictObject({
  habilitada: z.boolean(),
  limite_diario_usuario: z.number().int().min(1).max(1000),
  limite_diario_global: z.number().int().min(1).max(100000),
  /** Kill switch del modo agéntico (apagado por defecto). */
  modo_agentico_habilitado: z.boolean(),
  categorias_agenticas: z.array(z.enum(CATEGORIAS_AGENTICAS)).max(3)
    .refine((v) => new Set(v).size === v.length, 'No repitas categorías'),
  cupo_agentico_usuario_diario: z.number().int().min(1).max(100),
  cupo_agentico_aula_hora: z.number().int().min(1).max(100),
})
export type ConfigIA = z.infer<typeof configIaSchema>

export const configIaPatchSchema = configIaSchema.partial().refine((v) => Object.keys(v).length > 0, 'Envía al menos un campo')
export type ConfigIAPatch = z.infer<typeof configIaPatchSchema>

const entero = (min: number, max: number) =>
  z.number({ error: 'Escribe un número entero' })
    .int('Escribe un número entero')
    .min(min, `El mínimo es ${min}`)
    .max(max, `El máximo es ${max.toLocaleString('es-MX')}`)

/** Formulario de la pantalla de configuración: mismas reglas que el backend, con mensajes en español. */
export const configIaFormSchema = z.object({
  habilitada: z.boolean(),
  limite_diario_usuario: entero(1, 1000),
  limite_diario_global: entero(1, 100000),
  modo_agentico_habilitado: z.boolean(),
  categorias_agenticas: z.array(z.enum(CATEGORIAS_AGENTICAS)).max(3, 'Elige como máximo 3 categorías')
    .refine((v) => new Set(v).size === v.length, 'No repitas categorías'),
  cupo_agentico_usuario_diario: entero(1, 100),
  cupo_agentico_aula_hora: entero(1, 100),
})
