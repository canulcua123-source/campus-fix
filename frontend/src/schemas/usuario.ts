import { z } from 'zod'
import { CATEGORIAS } from './incidencia'

/** Espejo de backend/app/schemas/rol.py, routers/auth.py (LoginIn) y routers/usuarios.py (UsuarioIn/UsuarioPatch). */

export const PERMISOS = [
  'incidencias:crear',
  'incidencias:ver',
  'incidencias:asignar',
  'incidencias:buscar',
  'evidencias:subir',
  'seguimiento:registrar',
  'tags:gestionar',
  'analitica:ver',
  'usuarios:gestionar',
  'roles:gestionar',
  'categorias:gestionar',
  'ia:usar',
  'configuracion:gestionar',
] as const
export const ALCANCES = ['propio', 'area', 'edificio', 'global'] as const
export const TIPOS_REPORTANTE = ['docente', 'estudiante', 'administrativo'] as const

export type Permiso = (typeof PERMISOS)[number]
export type AlcanceRol = (typeof ALCANCES)[number]
export type TipoReportante = (typeof TIPOS_REPORTANTE)[number]

const RE_CLAVE_ROL = /^[a-z_]{3,30}$/

// ---------- auth ----------

/** LoginIn (POST /auth/login). */
export const loginSchema = z.object({
  correo: z.string().min(3, 'Escribe tu correo').max(254, 'Máximo 254 caracteres'),
  password: z.string().min(1, 'Escribe tu contraseña').max(128, 'Máximo 128 caracteres'),
})
export type LoginIn = z.infer<typeof loginSchema>

const usuarioSesion = z.object({
  nombre: z.string(),
  rol: z.string(),
  permisos: z.array(z.string()),
  alcance: z.enum(ALCANCES),
})

export const loginOutSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  usuario: usuarioSesion,
})
export type LoginOut = z.infer<typeof loginOutSchema>

/** GET /auth/me */
export const meSchema = usuarioSesion.extend({
  _id: z.string(),
  correo: z.string().optional(),
  areas: z.array(z.enum(CATEGORIAS)).optional(),
  edificios: z.array(z.string()).optional(),
  tipo_reportante: z.enum(TIPOS_REPORTANTE).optional(),
})
export type Me = z.infer<typeof meSchema>

// ---------- usuarios ----------

const nombreUsuario = z.string().min(3, 'Mínimo 3 caracteres').max(80, 'Máximo 80 caracteres')
const claveRol = z.string().regex(RE_CLAVE_ROL, 'Solo minúsculas y guion bajo (3 a 30)')
const areas = z.array(z.enum(CATEGORIAS, 'Área no válida')).max(3, 'Máximo 3 áreas')
const edificios = z.array(z.string().min(1, 'Edificio vacío').max(60, 'Máximo 60 caracteres')).max(20, 'Máximo 20 edificios')

/** UsuarioPatch (PATCH /usuarios/{id}): todos opcionales. */
export const usuarioPatchSchema = z.object({
  nombre: nombreUsuario.nullable().optional(),
  rol: claveRol.nullable().optional(),
  areas: areas.nullable().optional(),
  edificios: edificios.nullable().optional(),
  tipo_reportante: z.enum(TIPOS_REPORTANTE).nullable().optional(),
  activo: z.boolean().nullable().optional(),
})
export type UsuarioPatch = z.infer<typeof usuarioPatchSchema>

/** UsuarioIn (POST /usuarios). El correo se guarda en minúsculas y sin espacios, como el validador de Pydantic. */
export const usuarioInSchema = usuarioPatchSchema.extend({
  nombre: nombreUsuario,
  correo: z
    .string()
    .max(254, 'Máximo 254 caracteres')
    .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Correo inválido')
    .transform((v) => v.trim().toLowerCase()),
  password: z.string().min(10, 'Mínimo 10 caracteres').max(128, 'Máximo 128 caracteres'),
  rol: claveRol,
})
export type UsuarioIn = z.infer<typeof usuarioInSchema>

/** Usuario de GET/POST/PATCH /usuarios (sin password_hash). */
export const usuarioSchema = z.object({
  _id: z.string(),
  nombre: z.string(),
  correo: z.string(),
  rol: z.string(),
  areas: z.array(z.string()).optional(),
  edificios: z.array(z.string()).optional(),
  tipo_reportante: z.enum(TIPOS_REPORTANTE).optional(),
  activo: z.boolean().optional(),
  fecha_alta: z.string().optional(),
  fecha_creacion: z.string().optional(),
  schema_version: z.number().optional(),
})
export type UsuarioApi = z.infer<typeof usuarioSchema>
export const usuariosSchema = z.array(usuarioSchema)

// ---------- roles ----------

/** RolIn (POST /roles). */
export const rolInSchema = z.object({
  clave: claveRol,
  nombre: z.string().min(3, 'Mínimo 3 caracteres').max(50, 'Máximo 50 caracteres'),
  descripcion: z.string().max(200, 'Máximo 200 caracteres'),
  permisos: z
    .array(z.enum(PERMISOS, 'Permiso no válido'))
    .min(1, 'Selecciona al menos un permiso')
    .refine((v) => new Set(v).size === v.length, 'Permisos duplicados'),
  alcance: z.enum(ALCANCES, 'Selecciona el alcance'),
})
export type RolIn = z.infer<typeof rolInSchema>

export const rolSchema = z.object({
  _id: z.string(),
  clave: z.string(),
  nombre: z.string(),
  descripcion: z.string().optional(),
  permisos: z.array(z.string()),
  alcance: z.enum(ALCANCES),
  sistema: z.boolean().optional(),
})
export type Rol = z.infer<typeof rolSchema>
export const rolesSchema = z.array(rolSchema)
