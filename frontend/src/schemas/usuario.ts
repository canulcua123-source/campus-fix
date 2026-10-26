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
export const DOMINIO_CORREO = ((import.meta.env.VITE_DOMINIO_CORREO as string | undefined) ?? 'utm.edu.mx').trim().toLowerCase()
const correoBase = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Escribe tu correo')
  .max(254, 'Máximo 254 caracteres')
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Correo inválido')
const perteneceAlDominio = (correo: string) => correo.slice(correo.lastIndexOf('@') + 1) === DOMINIO_CORREO
const correoInstitucional = correoBase.refine(perteneceAlDominio, `Usa tu correo @${DOMINIO_CORREO}`)
const correoLogin = correoBase.refine(
  (correo) => perteneceAlDominio(correo) || correo === 'admin@utm.local',
  `Usa tu correo @${DOMINIO_CORREO}`,
)

// ---------- auth ----------

/** LoginIn (POST /auth/login). */
export const loginSchema = z.object({
  correo: correoLogin,
  password: z.string().min(1, 'Escribe tu contraseña').max(128, 'Máximo 128 caracteres'),
}).strict()
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
}).strict()
export type UsuarioPatch = z.infer<typeof usuarioPatchSchema>

/** UsuarioIn (POST /usuarios). El correo se guarda en minúsculas y sin espacios, como el validador de Pydantic. */
export const usuarioInSchema = usuarioPatchSchema.extend({
  nombre: nombreUsuario,
  correo: correoInstitucional,
  password: z.string().min(10, 'Mínimo 10 caracteres').max(128, 'Máximo 128 caracteres'),
  rol: claveRol,
}).strict()
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

/** GET /usuarios/tecnicos: técnicos asignables (sin correo). */
export const tecnicoSchema = z.object({
  _id: z.string(),
  nombre: z.string(),
  areas: z.array(z.string()).optional(),
  edificios: z.array(z.string()).optional(),
})
export type Tecnico = z.infer<typeof tecnicoSchema>
export const tecnicosSchema = z.array(tecnicoSchema)

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
}).strict()
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
