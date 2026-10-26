import { z } from 'zod'

/**
 * Catálogo de categorías (espejo de backend/app/schemas/categoria.py).
 * Las del sistema (computo_redes, infraestructura, academico) traen tipos históricos (`enum`, `lista_texto`);
 * las personalizadas solo pueden usar TIPOS_CAMPO_NUEVO.
 */

export const TIPOS_CAMPO_NUEVO = ['texto', 'numero', 'entero', 'booleano', 'ip', 'lista'] as const
export const TIPOS_CAMPO = [...TIPOS_CAMPO_NUEVO, 'enum', 'lista_texto'] as const
export type TipoCampoNuevo = (typeof TIPOS_CAMPO_NUEVO)[number]
export type TipoCampo = (typeof TIPOS_CAMPO)[number]

export const ETIQUETAS_TIPO_CAMPO: Record<TipoCampoNuevo, string> = {
  texto: 'Texto',
  numero: 'Número (con decimales)',
  entero: 'Número entero',
  booleano: 'Sí / No',
  ip: 'Dirección IP',
  lista: 'Lista de opciones',
}

/** Igual que `_normalizar_identificador` (dominio/categorias.py): minúsculas, sin acentos, espacios/guiones → `_`. */
export function normalizarIdentificador(texto: string): string {
  return texto.trim().toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '').replace(/[\s-]+/g, '_').replace(/_+/g, '_')
}

// ---------- salida (GET /categorias, CategoriaOut) ----------

export const campoCategoriaSchema = z.object({
  nombre: z.string(),
  etiqueta: z.string().optional(),
  tipo: z.enum(TIPOS_CAMPO),
  requerido: z.boolean(),
  opciones: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  max_length: z.number().optional(),
  patron: z.string().optional(),
})
export type CampoCategoria = z.infer<typeof campoCategoriaSchema>

export const categoriaSchema = z.object({
  _id: z.string(),
  clave: z.string(),
  nombre: z.string(),
  prefijo: z.string(),
  area_responsable: z.string(),
  version: z.number(),
  activa: z.boolean(),
  campos: z.array(campoCategoriaSchema),
  sistema: z.boolean().optional(),
  fecha_creacion: z.string().optional(),
  fecha_actualizacion: z.string().optional(),
})
export type CategoriaApi = z.infer<typeof categoriaSchema>
export const categoriasSchema = z.array(categoriaSchema)

export const CATEGORIAS_SISTEMA = ['computo_redes', 'infraestructura', 'academico'] as const
/** Igual que `es_categoria_sistema`: protegidas por marca o por clave sembrada. */
export const esCategoriaSistema = (c: Pick<CategoriaApi, 'clave' | 'sistema'>) =>
  c.sistema === true || (CATEGORIAS_SISTEMA as readonly string[]).includes(c.clave)

// ---------- entrada (POST/PATCH /categorias) ----------

const RE_NOMBRE_CAMPO = /^[a-z][a-z0-9_]{0,49}$/
const RE_CLAVE = /^[a-z][a-z0-9_]{2,29}$/
const limite = z.number('Debe ser un número').finite('Debe ser un número finito').optional()

/** CampoCategoria (Pydantic): mismas reglas por tipo que `_configuracion_por_tipo`. */
export const campoCategoriaInSchema = z
  .object({
    nombre: z.string('Indica el nombre interno').transform(normalizarIdentificador)
      .pipe(z.string().regex(RE_NOMBRE_CAMPO, 'Nombre interno: empieza con letra; solo letras, números y _ (máx. 50)')
        .refine((v) => v !== 'categoria', 'El nombre "categoria" está reservado')),
    etiqueta: z.string().trim().min(1, 'Escribe la etiqueta').max(80, 'Máximo 80 caracteres'),
    tipo: z.enum(TIPOS_CAMPO_NUEVO, 'Tipo de campo no válido'),
    requerido: z.boolean(),
    opciones: z.array(z.string().trim().min(1, 'Opción vacía').max(80, 'Máximo 80 caracteres por opción'))
      .min(1, 'Agrega al menos una opción').max(50, 'Máximo 50 opciones').optional(),
    min: limite,
    max: limite,
  })
  .superRefine((c, ctx) => {
    const error = (message: string, path: string) => ctx.addIssue({ code: 'custom', message, path: [path] })
    const conLimites = c.min !== undefined || c.max !== undefined
    if (c.tipo === 'lista') {
      if (!c.opciones) error('Los campos de tipo lista requieren opciones', 'opciones')
      else if (new Set(c.opciones).size !== c.opciones.length) error('Las opciones no pueden repetirse', 'opciones')
      if (conLimites) error('Los campos de tipo lista no admiten límites', 'min')
    } else if (c.opciones) error('Solo los campos de tipo lista admiten opciones', 'opciones')
    if ((c.tipo === 'booleano' || c.tipo === 'ip') && conLimites) error(`Los campos de tipo ${c.tipo} no admiten límites`, 'min')
    for (const [clave, v] of [['min', c.min], ['max', c.max]] as const) {
      if (v === undefined) continue
      if (c.tipo === 'texto' && (!Number.isInteger(v) || v < 0)) error('Los límites de texto deben ser enteros no negativos', clave)
      if (c.tipo === 'entero' && !Number.isInteger(v)) error('Los límites de un entero deben ser enteros', clave)
    }
    if (c.min !== undefined && c.max !== undefined && c.min > c.max) error('El mínimo no puede ser mayor que el máximo', 'max')
  })
export type CampoCategoriaIn = z.infer<typeof campoCategoriaInSchema>

const camposUnicos = (campos: CampoCategoriaIn[], ctx: z.RefinementCtx) => {
  const vistos = new Set<string>()
  campos.forEach((c, i) => {
    if (vistos.has(c.nombre)) ctx.addIssue({ code: 'custom', message: 'Los nombres de campos no pueden repetirse', path: [i, 'nombre'] })
    vistos.add(c.nombre)
  })
}
const campos = z.array(campoCategoriaInSchema).min(1, 'Agrega al menos un campo').max(30, 'Máximo 30 campos').superRefine(camposUnicos)
const nombreCategoria = z.string().trim().min(3, 'Mínimo 3 caracteres').max(80, 'Máximo 80 caracteres')
const prefijo = z.string().trim().regex(/^[A-Z]{3}$/, 'El prefijo son 3 letras mayúsculas (p. ej. LAB)')
const area = z.string().trim().min(3, 'Mínimo 3 caracteres').max(100, 'Máximo 100 caracteres')

/** CategoriaIn (POST /categorias). */
export const categoriaInSchema = z.object({
  clave: z.string('Indica la clave').transform(normalizarIdentificador)
    .pipe(z.string().regex(RE_CLAVE, 'Clave: empieza con letra; 3 a 30 letras, números o _')),
  nombre: nombreCategoria,
  prefijo,
  area_responsable: area,
  campos,
})
export type CategoriaIn = z.infer<typeof categoriaInSchema>

/** CategoriaPatch (PATCH /categorias/{clave}): sin null, al menos un cambio. */
export const categoriaPatchSchema = z
  .object({
    nombre: nombreCategoria.optional(),
    prefijo: prefijo.optional(),
    area_responsable: area.optional(),
    activa: z.boolean().optional(),
    campos: campos.optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), 'No hay cambios por guardar')
export type CategoriaPatch = z.infer<typeof categoriaPatchSchema>
