import { z } from 'zod'

import { RIESGOS, TIPOS_DANO } from './infraestructura'

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
  /** Pistas del control de calidad del cliente (Form `calidad_cliente`, CALIDADES_CLIENTE de routers/ia.py). */
  calidad_cliente: z.array(z.enum(['borrosa', 'oscura', 'sobreexpuesta'])).max(3).optional(),
})
export type AnalizarImagenIn = z.infer<typeof analizarImagenSchema>

/** DetalleInfraAnalisis: espejo de backend/app/schemas/ia.py. */
const detalleInfraAnalisisSchema = z.strictObject({
  tipo_dano: z.enum(TIPOS_DANO),
  riesgo_seguridad: z.enum(RIESGOS),
})

/** AnalisisImagen (extra="forbid": sin campos de más; todos requeridos salvo detalle_infra). */
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
  /** Solo en infraestructura; el backend omite el campo (nunca null) en las demás categorías. */
  detalle_infra: detalleInfraAnalisisSchema.optional(),
}).superRefine((analisis, ctx) => {
  if (analisis.categoria === 'infraestructura' && !analisis.detalle_infra) {
    ctx.addIssue({ code: 'custom', path: ['detalle_infra'], message: 'Obligatorio para infraestructura' })
  }
  if (analisis.categoria !== 'infraestructura' && analisis.detalle_infra) {
    ctx.addIssue({ code: 'custom', path: ['detalle_infra'], message: 'Solo se permite para infraestructura' })
  }
})
export type AnalisisImagen = z.infer<typeof analisisImagenSchema>

/** RespuestaIA: decisión del servidor (compuertas y confianza) y análisis con la confianza efectiva. */
export const respuestaIaSchema = z.strictObject({
  /** Compuertas G1–G9 del servidor; el cliente nunca puede forzar `agentico`. */
  accion: z.enum(['agentico', 'formulario', 'duplicado']),
  motivos: z.array(z.string()),
  /** Identificador opaco (UUID v4) del análisis temporal; dura 30 min y está ligado al usuario. */
  analisis_id: z.uuidv4(),
  analisis: analisisImagenSchema,
  /** Decisión de confianza (T-030): qué autollenar en el formulario. */
  accion_asistida: z.enum(['autollenar', 'sugerir', 'preguntar', 'rechazar']),
  mensaje: z.string().min(1),
  /** true si reutilizó un análisis sin consumir cupo. */
  cache: z.boolean(),
})
export type RespuestaIA = z.infer<typeof respuestaIaSchema>

/** EventoIAIn / EventoIAOut (POST /ia/eventos): lo único que el cliente puede declarar sobre una oferta. */
export const EVENTOS_IA_CLIENTE = ['deshecho', 'editado', 'fallback'] as const
const identificadorAnalisisSchema = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/)
export const eventoIaSchema = z.strictObject({
  analisis_id: identificadorAnalisisSchema,
  evento: z.enum(EVENTOS_IA_CLIENTE),
  motivo: z.enum(['usuario_deshizo', 'usuario_edito', 'continuo_manual']).optional(),
})
export type EventoIAIn = z.infer<typeof eventoIaSchema>
export const eventoIaOutSchema = z.strictObject({
  analisis_id: identificadorAnalisisSchema,
  evento: z.enum(EVENTOS_IA_CLIENTE),
  registrado: z.boolean(),
  es_final: z.boolean(),
})

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
