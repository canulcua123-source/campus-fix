import { z } from 'zod'

/** Espejo de backend/app/schemas/auditoria.py (campos null se omiten en la respuesta). */
export const RECURSOS_AUDITORIA = ['usuarios', 'roles', 'categorias', 'aulas'] as const
export const ACCIONES_AUDITORIA = ['crear', 'editar'] as const

export type RecursoAuditoria = (typeof RECURSOS_AUDITORIA)[number]
export type AccionAuditoria = (typeof ACCIONES_AUDITORIA)[number]

export type FiltrosAuditoria = {
  pagina?: number
  limite?: number
  recurso?: RecursoAuditoria
}

export const resumenAuditoriaSchema = z.object({
  rol: z.string().optional(),
  activo: z.boolean().optional(),
  areas: z.array(z.string()).optional(),
  edificios: z.array(z.string()).optional(),
  tipo_reportante: z.string().optional(),
  clave: z.string().optional(),
  alcance: z.string().optional(),
  cantidad_permisos: z.number().int().optional(),
  version: z.number().int().optional(),
  activa: z.boolean().optional(),
  prefijo: z.string().optional(),
  cantidad_campos: z.number().int().optional(),
  sistema: z.boolean().optional(),
  edificio: z.string().optional(),
  piso: z.number().int().optional(),
  aula: z.string().optional(),
}).strict()

export const eventoAuditoriaSchema = z.object({
  _id: z.string(),
  actor_id: z.string(),
  accion: z.enum(ACCIONES_AUDITORIA),
  recurso: z.enum(RECURSOS_AUDITORIA),
  recurso_id: z.string(),
  antes: resumenAuditoriaSchema.optional(),
  despues: resumenAuditoriaSchema,
  fecha: z.string(),
}).strict()

export const paginaAuditoriaSchema = z.object({
  pagina: z.number().int().positive(),
  limite: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  resultados: z.array(eventoAuditoriaSchema),
}).strict()

export type ResumenAuditoria = z.infer<typeof resumenAuditoriaSchema>
export type EventoAuditoria = z.infer<typeof eventoAuditoriaSchema>
export type PaginaAuditoria = z.infer<typeof paginaAuditoriaSchema>
