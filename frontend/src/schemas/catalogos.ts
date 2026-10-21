import { z } from 'zod'
import { CATEGORIAS } from './incidencia'

/** GET /categorias (documentos sembrados por backend/scripts/init_db.py · categorias_sistema). */

export const TIPOS_CAMPO = ['ip', 'entero', 'texto', 'enum', 'booleano', 'lista_texto'] as const

export const campoCategoriaSchema = z.object({
  nombre: z.string(),
  tipo: z.enum(TIPOS_CAMPO),
  requerido: z.boolean(),
  min: z.number().optional(),
  max: z.number().optional(),
  max_length: z.number().optional(),
  opciones: z.array(z.string()).optional(),
  patron: z.string().optional(),
})
export type CampoCategoria = z.infer<typeof campoCategoriaSchema>

export const categoriaSchema = z.object({
  _id: z.string(),
  clave: z.enum(CATEGORIAS),
  nombre: z.string(),
  prefijo: z.string(),
  area_responsable: z.string(),
  version: z.number(),
  activa: z.boolean(),
  campos: z.array(campoCategoriaSchema),
})
export type CategoriaApi = z.infer<typeof categoriaSchema>
export const categoriasSchema = z.array(categoriaSchema)
