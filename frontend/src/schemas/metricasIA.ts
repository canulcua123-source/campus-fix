import { z } from 'zod'

const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const instanteSchema = z.string().min(20)
const numeroNoNegativo = z.number().nonnegative().finite()

export type FiltrosMetricasIA = {
  desde?: string
  hasta?: string
  categoria?: string
  proveedor?: string
  modelo?: string
}

const tasaSchema = z.object({
  numerador: z.number().int().nonnegative(),
  denominador: z.number().int().nonnegative(),
  porcentaje: numeroNoNegativo.max(100).nullable(),
  disponible: z.boolean(),
  motivo: z.string().min(1).max(240).optional(),
}).strict()

const duracionSchema = z.object({
  muestras: z.number().int().nonnegative(),
  promedio_ms: numeroNoNegativo.nullable(),
  p50_ms: numeroNoNegativo.nullable(),
  p95_ms: numeroNoNegativo.nullable(),
}).strict()

const costoAgrupadoSchema = z.object({
  clave: z.string().min(1).max(100),
  costo_estimado_usd: numeroNoNegativo,
  llamadas_con_costo: z.number().int().positive(),
}).strict()

export const metricasIASchema = z.object({
  periodo: z.object({ desde: instanteSchema, hasta: instanteSchema }).strict(),
  totales: z.object({
    ofertas: z.number().int().nonnegative(),
    editadas: z.number().int().nonnegative(),
    deshechas: z.number().int().nonnegative(),
    enviadas: z.number().int().nonnegative(),
    duplicados_sumados: z.number().int().nonnegative(),
    fallback: z.number().int().nonnegative(),
  }).strict(),
  tasa_deshacer: tasaSchema,
  tasa_edicion: tasaSchema,
  correccion_tecnica_72h: tasaSchema,
  cobertura_agentica: tasaSchema,
  tiempo_toque_folio: duracionSchema,
  compuertas_fallidas: z.array(z.object({
    compuerta: z.enum(['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9']),
    total: z.number().int().positive(),
  }).strict()),
  latencia_ia: duracionSchema,
  errores_ia: z.number().int().nonnegative(),
  timeouts_ia: z.number().int().nonnegative(),
  costos: z.object({
    costo_estimado_periodo_usd: numeroNoNegativo.nullable(),
    llamadas_con_costo: z.number().int().nonnegative(),
    tokens_entrada: z.number().int().nonnegative().nullable(),
    tokens_salida: z.number().int().nonnegative().nullable(),
    diario: z.array(z.object({
      fecha: fechaSchema,
      costo_estimado_usd: numeroNoNegativo,
      llamadas_con_costo: z.number().int().positive(),
    }).strict()),
    por_proveedor: z.array(costoAgrupadoSchema),
    por_modelo: z.array(costoAgrupadoSchema),
    alerta: z.object({
      configurada: z.boolean(),
      activa: z.boolean(),
      umbral_diario_usd: numeroNoNegativo.nullable(),
      dias_excedidos: z.array(fechaSchema),
    }).strict(),
  }).strict(),
  semanal: z.array(z.object({
    semana: fechaSchema,
    ofertas: z.number().int().nonnegative(),
    deshechas: z.number().int().nonnegative(),
    editadas: z.number().int().nonnegative(),
    costo_estimado_usd: numeroNoNegativo.nullable(),
  }).strict()),
}).strict()

export type MetricasIA = z.infer<typeof metricasIASchema>
