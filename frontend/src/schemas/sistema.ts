import { z } from 'zod'

/** Espejo de backend/app/schemas/sistema.py (GET /sistema/salud y /sistema/resumen; los null se omiten). */

export const ESTADOS_COMPONENTE = ['ok', 'advertencia', 'error'] as const
export type EstadoComponente = (typeof ESTADOS_COMPONENTE)[number]

export const componenteSaludSchema = z.object({
  estado: z.enum(ESTADOS_COMPONENTE),
  detalle: z.string().max(200),
  latencia_ms: z.number().nonnegative().optional(),
}).strict()

export const saludIASchema = componenteSaludSchema.extend({
  habilitada: z.boolean(),
  proveedor: z.string(),
  modelo: z.string(),
  usados_hoy: z.number().int().nonnegative().optional(),
  limite_diario: z.number().int().positive().optional(),
  porcentaje_cupo: z.number().nonnegative().optional(),
}).strict()

export const saludSistemaSchema = z.object({
  estado: z.enum(['ok', 'degradado', 'caido']),
  version: z.string(),
  uptime_segundos: z.number().int().nonnegative(),
  fecha: z.string(),
  mongo: componenteSaludSchema,
  redis: componenteSaludSchema,
  almacenamiento: componenteSaludSchema,
  ia: saludIASchema,
}).strict()
export type ComponenteSalud = z.infer<typeof componenteSaludSchema>
export type SaludSistema = z.infer<typeof saludSistemaSchema>

export const alertaSistemaSchema = z.object({
  tipo: z.enum(['criticas_sin_asignar', 'vencidas', 'carga_tecnicos', 'cupo_ia']),
  severidad: z.enum(['critica', 'advertencia']),
  titulo: z.string(),
  detalle: z.string(),
  total: z.number().int().nonnegative(),
  enlace: z.string().startsWith('/'),
}).strict()
export type AlertaSistema = z.infer<typeof alertaSistemaSchema>

const conteoClaveSchema = z.object({ clave: z.string(), total: z.number().int().nonnegative() }).strict()

export const resumenSistemaSchema = z.object({
  kpis: z.object({
    abiertas: z.number().int().nonnegative(),
    criticas_sin_asignar: z.number().int().nonnegative(),
    vencidas: z.number().int().nonnegative(),
    resueltas_hoy: z.number().int().nonnegative(),
    resueltas_semana: z.number().int().nonnegative(),
    horas_resolucion_prom: z.number().nonnegative().optional(),
  }).strict(),
  alertas: z.array(alertaSistemaSchema),
  top_edificios: z.array(conteoClaveSchema),
  top_categorias: z.array(conteoClaveSchema),
  carga_tecnicos: z.array(z.object({
    tecnico_id: z.string().regex(/^[0-9a-f]{24}$/),
    nombre: z.string(),
    incidencias_activas: z.number().int().min(1),
    horas_acumuladas: z.number().nonnegative().finite(),
  }).strict()),
}).strict()
export type ResumenSistema = z.infer<typeof resumenSistemaSchema>
