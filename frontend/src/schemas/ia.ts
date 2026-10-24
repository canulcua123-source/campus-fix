import { z } from 'zod'

/** Espejo de backend/app/schemas/ia.py y de POST /ia/analizar-imagen (routers/ia.py). */

export const TIPOS_IMAGEN_IA = ['image/jpeg', 'image/png', 'image/webp'] as const
export const MAX_BYTES_IMAGEN_IA = 5 * 1024 * 1024

/** Entrada multipart: `imagen` (JPEG/PNG/WebP ≤ 5 MB) y `contexto` opcional (≤ 500). */
export const analizarImagenSchema = z.object({
  imagen: z
    .instanceof(Blob, { message: 'Selecciona una imagen' })
    .refine((b) => (TIPOS_IMAGEN_IA as readonly string[]).includes(b.type), 'Formato no permitido (usa JPEG, PNG o WebP)')
    .refine((b) => b.size <= MAX_BYTES_IMAGEN_IA, 'La imagen excede 5 MB'),
  contexto: z.string().max(500, 'Máximo 500 caracteres').optional(),
})
export type AnalizarImagenIn = z.infer<typeof analizarImagenSchema>

/** AnalisisImagen (extra="forbid": sin campos de más; todos requeridos). */
export const analisisImagenSchema = z.strictObject({
  es_incidencia_valida: z.boolean(),
  categoria: z.enum(['computo_redes', 'infraestructura', 'academico', 'no_determinada']),
  titulo: z.string(),
  descripcion: z.string(),
  prioridad_sugerida: z.enum(['baja', 'media', 'alta', 'critica']),
  tags: z.array(z.string()),
  campos_detectados: z.array(z.strictObject({ nombre: z.string(), valor: z.string() })),
  confianza: z.number().min(0).max(1),
  advertencias: z.array(z.string()),
  cache: z.boolean(),
})
export type AnalisisImagen = z.infer<typeof analisisImagenSchema>
