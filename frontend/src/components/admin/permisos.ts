import type { AlcanceRol, Permiso } from '../../schemas/usuario'
import { ETIQUETAS_PERMISO } from '../../schemas/etiquetas'

/** Textos de ayuda para Usuarios y Roles (solo presentación: la semántica de permisos vive en el backend). */

export const DESCRIPCION_PERMISO: Record<Permiso, string> = {
  'incidencias:crear': 'Reportar fallas desde la app',
  'incidencias:ver': 'Consultar reportes dentro de su alcance',
  'incidencias:asignar': 'Asignar o reasignar técnicos a un reporte',
  'incidencias:buscar': 'Usar la búsqueda avanzada de reportes',
  'evidencias:subir': 'Adjuntar fotos y documentos a un reporte',
  'seguimiento:registrar': 'Cambiar el estado y anotar avances',
  'tags:gestionar': 'Agregar o quitar etiquetas en los reportes',
  'analitica:ver': 'Ver tablero, métricas y reportes',
  'usuarios:gestionar': 'Crear, editar y desactivar cuentas',
  'roles:gestionar': 'Crear y editar roles y sus permisos',
  'categorias:gestionar': 'Administrar categorías y catálogos',
  'ia:usar': 'Recibir sugerencias de la IA al reportar',
  'configuracion:gestionar': 'Cambiar ajustes generales del sistema',
  'sistema:administrar': 'Centro de control y cuentas de administración (solo superadmin)',
}

export const DESCRIPCION_ALCANCE: Record<AlcanceRol, string> = {
  propio: 'Solo ve los reportes que creó',
  area: 'Ve los reportes de las áreas que le asignes',
  edificio: 'Ve los reportes de los edificios que le asignes',
  global: 'Ve todos los reportes del campus',
}

export const GRUPOS_PERMISOS: { clave: string; titulo: string; permisos: Permiso[] }[] = [
  { clave: 'incidencias', titulo: 'Incidencias', permisos: ['incidencias:crear', 'incidencias:ver', 'incidencias:asignar', 'incidencias:buscar'] },
  { clave: 'evidencias', titulo: 'Evidencias', permisos: ['evidencias:subir'] },
  { clave: 'ia', titulo: 'Inteligencia artificial', permisos: ['ia:usar'] },
  { clave: 'seguimiento', titulo: 'Seguimiento', permisos: ['seguimiento:registrar', 'tags:gestionar'] },
  { clave: 'analitica', titulo: 'Analítica', permisos: ['analitica:ver'] },
  { clave: 'administracion', titulo: 'Administración', permisos: ['usuarios:gestionar', 'roles:gestionar', 'categorias:gestionar', 'configuracion:gestionar', 'sistema:administrar'] },
]

/** Texto legible de un permiso (o la clave cruda si la API manda uno desconocido). */
export function etiquetaPermiso(p: string): string {
  return ETIQUETAS_PERMISO[p as Permiso] ?? p
}

/** Agrupa los permisos de un rol por dominio, en el orden de GRUPOS_PERMISOS; los desconocidos van en "Otros". */
export function permisosAgrupados(permisos: readonly string[]): { titulo: string; permisos: string[] }[] {
  const grupos = GRUPOS_PERMISOS
    .map((g) => ({ titulo: g.titulo, permisos: g.permisos.filter((p) => permisos.includes(p)) as string[] }))
    .filter((g) => g.permisos.length)
  const conocidos = new Set<string>(GRUPOS_PERMISOS.flatMap((g) => g.permisos))
  const otros = permisos.filter((p) => !conocidos.has(p))
  return otros.length ? [...grupos, { titulo: 'Otros', permisos: otros }] : grupos
}

/** Iniciales para el avatar ("Ana López" → "AL"). */
export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean)
  return ((partes[0]?.[0] ?? '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toLocaleUpperCase('es-MX') || '?'
}
