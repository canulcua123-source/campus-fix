/** Permisos de los 5 roles base: espejo de roles_sistema() en backend/scripts/init_db.py. */
const REPORTANTE = ['incidencias:crear', 'incidencias:ver', 'evidencias:subir', 'ia:usar']
const TECNICO = [...REPORTANTE, 'seguimiento:registrar', 'tags:gestionar', 'incidencias:buscar']
const COORDINADOR = [...TECNICO, 'incidencias:asignar', 'analitica:ver']
const DIRECTIVO = ['incidencias:ver', 'incidencias:buscar', 'analitica:ver']
const ADMIN = [
  'incidencias:crear', 'incidencias:ver', 'incidencias:asignar', 'incidencias:buscar', 'evidencias:subir',
  'seguimiento:registrar', 'tags:gestionar', 'analitica:ver', 'usuarios:gestionar', 'roles:gestionar',
  'categorias:gestionar', 'ia:usar', 'configuracion:gestionar',
]

export const ROLES_BASE = {
  reportante: { permisos: REPORTANTE, alcance: 'propio' },
  tecnico: { permisos: TECNICO, alcance: 'area' },
  coordinador: { permisos: COORDINADOR, alcance: 'area' },
  directivo: { permisos: DIRECTIVO, alcance: 'global' },
  admin: { permisos: ADMIN, alcance: 'global' },
} as const

export type RolBase = keyof typeof ROLES_BASE

export function sesionDe(rol: RolBase) {
  const { permisos, alcance } = ROLES_BASE[rol]
  return { nombre: `Usuario ${rol}`, rol, permisos: [...permisos], alcance }
}
