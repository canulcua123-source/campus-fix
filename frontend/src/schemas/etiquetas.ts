import type { Categoria, Estado, Prioridad } from './incidencia'
import type { AlcanceRol, Permiso, TipoReportante } from './usuario'

/** Etiquetas en español para los enums de la API (se muestran en la UI; el valor viaja tal cual). */

export const ETIQUETAS_ESTADO: Record<Estado, string> = {
  abierta: 'Abierta',
  en_proceso: 'En proceso',
  en_espera: 'En espera',
  resuelta: 'Resuelta',
  cerrada: 'Cerrada',
  retirada: 'Retirada',
}

export const ETIQUETAS_PRIORIDAD: Record<Prioridad, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
  critica: 'Crítica',
}

export const ETIQUETAS_CATEGORIA: Record<Categoria, string> = {
  computo_redes: 'Cómputo y redes',
  infraestructura: 'Infraestructura',
  academico: 'Académico',
}

export const ETIQUETAS_TIPO_DANO = {
  filtracion: 'Filtración',
  electrico: 'Eléctrico',
  climatizacion: 'Climatización',
  cerrajeria: 'Cerrajería',
  luminaria: 'Luminaria',
  otro: 'Otro',
} as const

export const ETIQUETAS_RIESGO = { bajo: 'Bajo', medio: 'Medio', alto: 'Alto' } as const

export const ETIQUETAS_PLATAFORMA = {
  lms: 'LMS',
  portal_calificaciones: 'Portal de calificaciones',
  correo: 'Correo institucional',
} as const

export const ETIQUETAS_ALCANCE: Record<AlcanceRol, string> = {
  propio: 'Solo lo propio',
  area: 'Por área',
  edificio: 'Por edificio',
  global: 'Todo el campus',
}

export const ETIQUETAS_TIPO_REPORTANTE: Record<TipoReportante, string> = {
  docente: 'Docente',
  estudiante: 'Estudiante',
  administrativo: 'Administrativo',
}

export const ETIQUETAS_PERMISO: Record<Permiso, string> = {
  'incidencias:crear': 'Crear incidencias',
  'incidencias:ver': 'Ver incidencias',
  'incidencias:asignar': 'Asignar incidencias',
  'incidencias:buscar': 'Buscar incidencias',
  'evidencias:subir': 'Subir evidencias',
  'seguimiento:registrar': 'Registrar seguimiento',
  'tags:gestionar': 'Gestionar tags',
  'analitica:ver': 'Ver analítica',
  'usuarios:gestionar': 'Gestionar usuarios',
  'roles:gestionar': 'Gestionar roles',
  'categorias:gestionar': 'Gestionar categorías',
  'ia:usar': 'Usar IA',
  'configuracion:gestionar': 'Gestionar configuración',
}

export const ETIQUETAS_MIME = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'application/pdf': 'PDF',
  'video/mp4': 'MP4',
  'video/quicktime': 'MOV',
  'video/webm': 'WebM',
} as const
