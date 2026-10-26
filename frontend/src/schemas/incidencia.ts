import { z } from 'zod'

/**
 * Espejo de backend/app/schemas/incidencia.py y de las clases ...In de backend/app/routers/incidencias.py (FB-12).
 * Mismos nombres, enums, mínimos, máximos y patrones. Si cambia Pydantic, cambia aquí en el mismo PR.
 */

export const PRIORIDADES = ['baja', 'media', 'alta', 'critica'] as const
export const ESTADOS = ['abierta', 'en_proceso', 'en_espera', 'resuelta', 'cerrada', 'retirada'] as const
export const ESTADOS_SEGUIMIENTO = ['abierta', 'en_proceso', 'en_espera', 'resuelta', 'cerrada'] as const
export const CATEGORIAS = ['computo_redes', 'infraestructura', 'academico'] as const
export const TIPOS_DANO = ['filtracion', 'electrico', 'climatizacion', 'cerrajeria', 'luminaria', 'otro'] as const
export const RIESGOS = ['bajo', 'medio', 'alto'] as const
export const PLATAFORMAS = ['lms', 'portal_calificaciones', 'correo'] as const
export const TIPOS_MIME_EVIDENCIA = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const

export type Categoria = (typeof CATEGORIAS)[number]
export type Estado = (typeof ESTADOS)[number]
export type EstadoSeguimiento = (typeof ESTADOS_SEGUIMIENTO)[number]
export type Prioridad = (typeof PRIORIDADES)[number]
export type TipoMimeEvidencia = (typeof TIPOS_MIME_EVIDENCIA)[number]

/** TRANSICIONES de incidencia.py: estado actual → estados destino permitidos. */
export const TRANSICIONES: Record<Estado, readonly Estado[]> = {
  abierta: ['en_proceso', 'en_espera'],
  en_proceso: ['en_espera', 'resuelta'],
  en_espera: ['en_proceso'],
  resuelta: ['cerrada', 'en_proceso'],
  cerrada: [],
  retirada: [],
}

export const LIMITES = {
  titulo: [5, 120],
  descripcion: [10, 2000],
  edificio: [1, 60],
  aula: [1, 60],
  piso: [-5, 50],
  vlan: [1, 4094],
  puerto_uplink_max: 20,
  equipos_afectados: [1, 10000],
  estudiantes_impactados: [0, 100000],
  insumos_max: 10,
  insumo: [1, 60],
  tags_max: 15,
  comentario: [5, 1000],
  horas: [0, 24],
  nombre_archivo: [1, 120],
  peso_bytes_max: 10 * 1024 * 1024,
} as const

// ---------- tags ----------

const RE_TAG = /^[a-z0-9_]{2,30}$/

/** Igual que `normalizar_tag` de Python: strip, minúsculas, sin acentos, espacios → `_`. */
export function normalizarTag(texto: string): string {
  return texto.trim().toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '').replace(/\s+/g, '_')
}

const tagSchema = z.string().transform(normalizarTag).pipe(z.string().regex(RE_TAG, 'Tag inválido: 2 a 30 letras, números o _'))
/** Igual que el validador `_tags`: normaliza, quita duplicados y ordena. */
const ordenarUnicos = (v: string[]) => [...new Set(v)].sort()

// ---------- entradas ----------

const detalleComputo = z.object({
  categoria: z.literal('computo_redes'),
  ip: z.union([z.ipv4('IP inválida'), z.ipv6('IP inválida')], 'IP inválida'),
  vlan: z.number('La VLAN es obligatoria').int('Debe ser entero').min(1, 'VLAN mínima 1').max(4094, 'VLAN máxima 4094'),
  // Pydantic: Field(max_length=20) sin mínimo
  puerto_uplink: z.string('Requerido').max(20, 'Máximo 20 caracteres'),
  equipos_afectados: z.number('Requerido').int('Debe ser entero').min(1, 'Al menos 1 equipo').max(10000, 'Máximo 10000 equipos'),
})

const detalleInfra = z.object({
  categoria: z.literal('infraestructura'),
  tipo_dano: z.enum(TIPOS_DANO, 'Selecciona un tipo'),
  riesgo_seguridad: z.enum(RIESGOS, 'Selecciona el riesgo'),
  requiere_insumos: z.boolean(),
  insumos: z
    .array(z.string().min(1, 'Insumo vacío').max(60, 'Máximo 60 caracteres por insumo'))
    .max(10, 'Máximo 10 insumos')
    .nullable()
    .optional(),
  requiere_contratista: z.boolean(),
})

const detalleAcademico = z.object({
  categoria: z.literal('academico'),
  plataforma: z.enum(PLATAFORMAS, 'Selecciona la plataforma'),
  codigo_curso: z.string('Requerido').regex(/^[A-Z]{2,4}-\d{3}$/, 'Formato esperado: MAT-101'),
  periodo: z.string('Requerido').regex(/^\d{4}-[12]$/, 'Formato esperado: 2026-1'),
  estudiantes_impactados: z.number('Requerido').int('Debe ser entero').min(0, 'No puede ser negativo').max(100000, 'Máximo 100000'),
})

export const detalleEspecificoSchema = z.discriminatedUnion('categoria', [detalleComputo, detalleInfra, detalleAcademico])

export const ubicacionSchema = z.object({
  edificio: z.string('Indica el edificio').min(1, 'Indica el edificio').max(60, 'Máximo 60 caracteres'),
  piso: z.number().int('Debe ser entero').min(-5, 'Piso mínimo -5').max(50, 'Piso máximo 50').nullable().optional(),
  aula: z.string('Indica el aula').min(1, 'Indica el aula').max(60, 'Máximo 60 caracteres'),
})

/** IncidenciaIn (POST /incidencias). */
export const incidenciaSchema = z.object({
  titulo: z.string('Requerido').min(5, 'Mínimo 5 caracteres').max(120, 'Máximo 120 caracteres'),
  descripcion: z.string('Requerido').min(10, 'Mínimo 10 caracteres').max(2000, 'Máximo 2000 caracteres'),
  prioridad: z.enum(PRIORIDADES, 'Selecciona la prioridad'),
  ubicacion: ubicacionSchema,
  detalle_especifico: detalleEspecificoSchema,
  tags: z.array(tagSchema).max(15, 'Máximo 15 tags').transform(ordenarUnicos),
})
export type IncidenciaForm = z.infer<typeof incidenciaSchema>
export type IncidenciaIn = IncidenciaForm

/** SeguimientoIn (PATCH /incidencias/{id}/seguimiento). */
export const seguimientoSchema = z.object({
  estado_nuevo: z.enum(ESTADOS_SEGUIMIENTO, 'Selecciona el nuevo estado'),
  comentario: z.string('Requerido').min(5, 'Mínimo 5 caracteres').max(1000, 'Máximo 1000 caracteres'),
  horas: z.number('Indica las horas').finite().min(0, 'No puede ser negativo').max(24, 'Máximo 24 horas')
    .multipleOf(0.25, 'Usa incrementos de 0.25 horas'),
})
export type SeguimientoIn = z.infer<typeof seguimientoSchema>

/** TagsIn (POST/DELETE /incidencias/{id}/tags). */
export const tagsSchema = z.object({
  tags: z.array(tagSchema).min(1, 'Agrega al menos un tag').max(15, 'Máximo 15 tags').transform(ordenarUnicos),
})
export type TagsIn = z.infer<typeof tagsSchema>

/** AsignacionIn (PATCH /incidencias/{id}/asignacion). */
export const asignacionSchema = z.object({
  tecnico_id: z.string().length(24, 'Selecciona un técnico'),
})
export type AsignacionIn = z.infer<typeof asignacionSchema>

/** EvidenciaFirmaIn (POST /incidencias/{id}/evidencias/firma). */
export const evidenciaFirmaSchema = z.object({
  nombre_archivo: z
    .string()
    .min(1, 'Nombre de archivo vacío')
    .max(120, 'Nombre de archivo de máximo 120 caracteres')
    .regex(/^[^/\\]+$/, 'El nombre no puede contener / ni \\')
    .refine((v) => !v.includes('..'), "El nombre no puede contener '..'"),
  tipo_mime: z.enum(TIPOS_MIME_EVIDENCIA, 'Formato no permitido (JPEG, PNG, WebP o PDF)'),
  peso_bytes: z.number().int().min(1, 'El archivo está vacío').max(10 * 1024 * 1024, 'El archivo excede 10 MB'),
})
export type EvidenciaFirmaIn = z.infer<typeof evidenciaFirmaSchema>

/** EvidenciaIn (POST /incidencias/{id}/evidencias). */
export const evidenciaSchema = z.object({ evidencia_id: z.uuidv4('Identificador inválido') })
export type EvidenciaIn = z.infer<typeof evidenciaSchema>

/** Query de GET /incidencias. */
export const filtrosIncidenciasSchema = z.object({
  estado: z.enum(ESTADOS).optional(),
  categoria: z.enum(CATEGORIAS).optional(),
  prioridad: z.enum(PRIORIDADES).optional(),
  edificio: z.string().max(60).optional(),
  limite: z.number().int().min(1).max(100).optional(),
})
export type FiltrosIncidencias = z.infer<typeof filtrosIncidenciasSchema>

/** Query de GET /incidencias/buscar. */
export const busquedaSchema = z.string().trim().min(2, 'Escribe al menos 2 caracteres').max(100, 'Máximo 100 caracteres')

// ---------- respuestas ----------
// Más tolerantes que las entradas (sin límites de longitud): validan forma y tipos, no reglas de captura.

const fecha = z.string()
const personaRef = z.object({ usuario_id: z.string(), nombre: z.string() })

const ubicacionOut = z.object({ edificio: z.string(), piso: z.number().nullable().optional(), aula: z.string() })

export const incidenciaListaItemSchema = z.object({
  _id: z.string(),
  codigo: z.string(),
  titulo: z.string(),
  categoria: z.enum(CATEGORIAS),
  estado: z.enum(ESTADOS),
  prioridad: z.enum(PRIORIDADES),
  ubicacion: ubicacionOut,
  tags: z.array(z.string()).default([]),
  fecha_creacion: fecha,
  tecnico_asignado: personaRef.optional(),
  score: z.number().optional(), // solo en /incidencias/buscar
})
export type IncidenciaListaItem = z.infer<typeof incidenciaListaItemSchema>
export const incidenciaListaSchema = z.array(incidenciaListaItemSchema)

const detalleOut = z.discriminatedUnion('categoria', [
  z.object({ categoria: z.literal('computo_redes'), ip: z.string(), vlan: z.number(), puerto_uplink: z.string(), equipos_afectados: z.number() }),
  z.object({
    categoria: z.literal('infraestructura'), tipo_dano: z.enum(TIPOS_DANO), riesgo_seguridad: z.enum(RIESGOS),
    requiere_insumos: z.boolean(), insumos: z.array(z.string()).nullable().optional(), requiere_contratista: z.boolean(),
  }),
  z.object({
    categoria: z.literal('academico'), plataforma: z.enum(PLATAFORMAS), codigo_curso: z.string(), periodo: z.string(),
    estudiantes_impactados: z.number(),
  }),
])

export const evidenciaAdjuntaSchema = z.object({
  evidencia_id: z.string(),
  nombre_archivo: z.string(),
  tipo_mime: z.enum(TIPOS_MIME_EVIDENCIA),
  peso_kb: z.number(),
  url_storage: z.string(),
  fecha_carga: fecha,
  subido_por: z.string(),
})
export type EvidenciaAdjunta = z.infer<typeof evidenciaAdjuntaSchema>

export const entradaHistorialSchema = z.object({
  autor_nombre: z.string().optional(),
  fecha,
  usuario_id: z.string(),
  estado_nuevo: z.enum(ESTADOS),
  comentario: z.string(),
  horas: z.number(),
  tipo: z.literal('asignacion').optional(),
})
export type EntradaHistorial = z.infer<typeof entradaHistorialSchema>

export const incidenciaDetalleSchema = incidenciaListaItemSchema.omit({ score: true }).extend({
  descripcion: z.string(),
  reportante: personaRef,
  detalle_especifico: detalleOut,
  evidencias_adjuntas: z.array(evidenciaAdjuntaSchema).default([]),
  horas_invertidas: z.number().default(0),
  historial_seguimiento: z.array(entradaHistorialSchema).default([]),
  fecha_actualizacion: fecha.optional(),
  fecha_resolucion: fecha.optional(),
  schema_version: z.number().optional(),
  puede_retirar: z.boolean().default(false),
})
export type IncidenciaDetalle = z.infer<typeof incidenciaDetalleSchema>

export const incidenciaCreadaSchema = z.object({ _id: z.string(), codigo: z.string(), estado: z.enum(ESTADOS) })
export type IncidenciaCreada = z.infer<typeof incidenciaCreadaSchema>

export const okSchema = z.object({ ok: z.literal(true) })
export const seguimientoOutSchema = okSchema.extend({ estado: z.enum(ESTADOS) })
export const asignacionOutSchema = okSchema.extend({ tecnico_asignado: personaRef })

export const firmaEvidenciaOutSchema = z.object({
  evidencia_id: z.string(),
  url_storage: z.string(),
  upload_url: z.string(),
  expira_en: z.number(),
})
export type FirmaEvidencia = z.infer<typeof firmaEvidenciaOutSchema>
export const evidenciaRegistradaSchema = okSchema.extend({ evidencia_id: z.string() })
export const urlEvidenciaSchema = z.object({ url: z.string(), expira_en: z.number() })

// Compatibilidad: el análisis de imagen vive en schemas/ia.ts.
export { analisisImagenSchema, type AnalisisImagen } from './ia'
