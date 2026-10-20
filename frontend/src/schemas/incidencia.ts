import { z } from 'zod'

export const PRIORIDADES = ['baja', 'media', 'alta', 'critica'] as const
export const ESTADOS = ['abierta', 'en_proceso', 'en_espera', 'resuelta', 'cerrada'] as const
export const CATEGORIAS = ['computo_redes', 'infraestructura', 'academico'] as const

const detalleComputo = z.object({
  categoria: z.literal('computo_redes'),
  ip: z.union([z.ipv4('IP inválida'), z.ipv6('IP inválida')]),
  vlan: z.number('La VLAN es obligatoria').int().min(1, 'VLAN mínima 1').max(4094, 'VLAN máxima 4094'),
  puerto_uplink: z.string().min(1, 'Requerido').max(20, 'Máximo 20 caracteres'),
  equipos_afectados: z.number('Requerido').int().min(1, 'Al menos 1 equipo'),
})

const detalleInfra = z.object({
  categoria: z.literal('infraestructura'),
  tipo_dano: z.enum(['filtracion', 'electrico', 'climatizacion', 'cerrajeria', 'luminaria', 'otro'], 'Selecciona un tipo'),
  riesgo_seguridad: z.enum(['bajo', 'medio', 'alto'], 'Selecciona el riesgo'),
  requiere_insumos: z.boolean(),
  insumos: z.array(z.string()).nullable().optional(),
  requiere_contratista: z.boolean(),
})

const detalleAcademico = z.object({
  categoria: z.literal('academico'),
  plataforma: z.enum(['lms', 'portal_calificaciones', 'correo'], 'Selecciona la plataforma'),
  codigo_curso: z.string().regex(/^[A-Z]{2,4}-\d{3}$/, 'Formato esperado: MAT-101'),
  periodo: z.string().regex(/^\d{4}-[12]$/, 'Formato esperado: 2026-1'),
  estudiantes_impactados: z.number('Requerido').int().min(0, 'No puede ser negativo'),
})

export const detalleEspecificoSchema = z.discriminatedUnion('categoria', [detalleComputo, detalleInfra, detalleAcademico])

export const incidenciaSchema = z.object({
  titulo: z.string().min(5, 'Mínimo 5 caracteres').max(120, 'Máximo 120 caracteres'),
  descripcion: z.string().min(10, 'Mínimo 10 caracteres').max(2000, 'Máximo 2000 caracteres'),
  prioridad: z.enum(PRIORIDADES, 'Selecciona la prioridad'),
  ubicacion: z.object({
    edificio: z.string().min(1, 'Requerido'),
    piso: z.number().int().nullable().optional(),
    aula: z.string().min(1, 'Requerido'),
  }),
  detalle_especifico: detalleEspecificoSchema,
  tags: z.array(z.string().regex(/^[a-z0-9_]{2,30}$/, 'Tag inválido')).max(15, 'Máximo 15 tags'),
})

export type IncidenciaForm = z.infer<typeof incidenciaSchema>
export type Categoria = (typeof CATEGORIAS)[number]
export type Estado = (typeof ESTADOS)[number]
export type Prioridad = (typeof PRIORIDADES)[number]

export const analisisImagenSchema = z.object({
  es_incidencia_valida: z.boolean(),
  categoria: z.enum([...CATEGORIAS, 'no_determinada']),
  titulo: z.string(),
  descripcion: z.string(),
  prioridad_sugerida: z.enum(PRIORIDADES),
  tags: z.array(z.string()),
  campos_detectados: z.array(z.object({ nombre: z.string(), valor: z.string() })),
  confianza: z.number().min(0).max(1),
  advertencias: z.array(z.string()),
})
export type AnalisisImagen = z.infer<typeof analisisImagenSchema>
