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
})
export type AnalisisImagen = z.infer<typeof analisisImagenSchema>

const categoriaSchema = z.string().regex(/^[a-z][a-z0-9_]{2,29}$/)
const coincidenciaIdSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)

/** Contrato independiente de T-038; T-033 lo incorporara a su respuesta G8. */
export const posibleDuplicadoSchema = z.strictObject({
  accion: z.literal('duplicado'),
  coincidencia_id: coincidenciaIdSchema,
  codigo: z.string().min(1).max(64),
  categoria: categoriaSchema,
  reportado_hace_minutos: z.number().int().min(0).max(1440),
  adhesiones: z.number().int().min(0),
})
export type PosibleDuplicado = z.infer<typeof posibleDuplicadoSchema>

export const confirmarAdhesionSchema = z.strictObject({
  coincidencia_id: coincidenciaIdSchema,
})
export type ConfirmarAdhesionIn = z.infer<typeof confirmarAdhesionSchema>

export const adhesionSchema = z.strictObject({
  ok: z.literal(true),
  codigo: z.string().min(1).max(64),
  categoria: categoriaSchema,
  adhesiones: z.number().int().min(1),
  registrada: z.boolean(),
})
export type Adhesion = z.infer<typeof adhesionSchema>
