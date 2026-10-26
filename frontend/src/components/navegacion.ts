import {
  BarChart3, BrainCircuit, Building2, Camera, ClipboardList, FileText, History, Home, Inbox, KanbanSquare, LayoutDashboard, ListChecks,
  Search, Settings, Shield, Tags, UserRound, Users, Wrench, type LucideIcon,
} from 'lucide-react'

/**
 * Navegación por rol: matriz «Pantallas por rol» de docs/TAREAS.md.
 * El perfil se deduce de los permisos del usuario (no del nombre del rol) y cada
 * elemento se filtra además por su propio permiso (UX-31). La seguridad real está en la API.
 */
export type PerfilNav = 'reportante' | 'tecnico' | 'coordinador' | 'directivo' | 'admin'

export interface ItemNav {
  to: string
  etiqueta: string
  icono: LucideIcon
  /** Permiso requerido; sin permiso = basta con tener sesión. */
  permiso?: string
}

/** Marcador del botón central de cámara (Reportar) en la barra inferior. */
export const REPORTAR: ItemNav = { to: '/reportar', etiqueta: 'Reportar', icono: Camera, permiso: 'incidencias:crear' }

const I = {
  inicio: { to: '/', etiqueta: 'Inicio', icono: Home },
  // TODO(T-045): la ruta cambiará a /mis-reportes.
  misReportes: { to: '/mis-tickets', etiqueta: 'Mis reportes', icono: ClipboardList, permiso: 'incidencias:ver' },
  perfil: { to: '/perfil', etiqueta: 'Perfil', icono: UserRound },
  bandeja: { to: '/bandeja', etiqueta: 'Bandeja', icono: Inbox, permiso: 'seguimiento:registrar' },
  buscar: { to: '/buscar', etiqueta: 'Buscar', icono: Search, permiso: 'incidencias:buscar' },
  tablero: { to: '/tablero', etiqueta: 'Tablero', icono: KanbanSquare, permiso: 'incidencias:asignar' },
  metricas: { to: '/dashboard', etiqueta: 'Métricas', icono: BarChart3, permiso: 'analitica:ver' },
  dashboard: { to: '/dashboard', etiqueta: 'Dashboard', icono: LayoutDashboard, permiso: 'analitica:ver' },
  incidencias: { to: '/buscar', etiqueta: 'Incidencias', icono: ListChecks, permiso: 'incidencias:buscar' },
  tecnicos: { to: '/tecnicos', etiqueta: 'Técnicos', icono: Wrench, permiso: 'incidencias:asignar' },
  reportes: { to: '/reportes', etiqueta: 'Reportes', icono: FileText, permiso: 'analitica:ver' },
  usuarios: { to: '/admin/usuarios', etiqueta: 'Usuarios', icono: Users, permiso: 'usuarios:gestionar' },
  roles: { to: '/admin/roles', etiqueta: 'Roles', icono: Shield, permiso: 'roles:gestionar' },
  categorias: { to: '/admin/categorias', etiqueta: 'Categorías', icono: Tags, permiso: 'categorias:gestionar' },
  edificios: { to: '/admin/edificios', etiqueta: 'Edificios', icono: Building2, permiso: 'usuarios:gestionar' },
  auditoria: { to: '/admin/auditoria', etiqueta: 'Auditoría', icono: History, permiso: 'usuarios:gestionar' },
  configuracion: { to: '/admin/configuracion', etiqueta: 'Configuración', icono: Settings, permiso: 'usuarios:gestionar' },
  metricasIA: { to: '/admin/metricas-ia', etiqueta: 'Métricas IA', icono: BrainCircuit, permiso: 'analitica:ver' },
} satisfies Record<string, ItemNav>

interface Config {
  /** Barra inferior (< 1024 px), en orden; REPORTAR es el botón central de cámara. Máx. 5 (UX-03). */
  movil: ItemNav[]
  /** Menú lateral (≥ 1024 px). Perfil y Reportar van aparte. */
  lateral: ItemNav[]
}

export const NAVEGACION: Record<PerfilNav, Config> = {
  reportante: { movil: [I.inicio, REPORTAR, I.misReportes, I.perfil], lateral: [I.inicio, I.misReportes] },
  tecnico: { movil: [I.bandeja, I.buscar, REPORTAR, I.perfil], lateral: [I.bandeja, I.buscar, I.misReportes] },
  coordinador: {
    movil: [I.tablero, I.bandeja, REPORTAR, I.metricas, I.perfil],
    lateral: [I.tablero, I.incidencias, I.tecnicos, I.metricas],
  },
  directivo: { movil: [I.dashboard, I.buscar, I.perfil], lateral: [I.dashboard, I.incidencias, I.reportes] },
  admin: {
    movil: [I.usuarios, I.roles, I.categorias, I.metricasIA, I.perfil],
    lateral: [I.usuarios, I.roles, I.categorias, I.metricasIA, I.edificios, I.auditoria, I.configuracion],
  },
}

export const PERFIL_ITEM = I.perfil

/** Deduce el perfil de navegación a partir de los permisos (del más amplio al más acotado). */
export function perfilDe(permisos: readonly string[]): PerfilNav {
  const p = new Set(permisos)
  if (p.has('usuarios:gestionar') || p.has('roles:gestionar') || p.has('categorias:gestionar')) return 'admin'
  if (p.has('incidencias:asignar')) return 'coordinador'
  if (p.has('seguimiento:registrar')) return 'tecnico'
  if (p.has('analitica:ver')) return 'directivo'
  return 'reportante'
}

/** Pestañas visibles para unos permisos: configuración del perfil filtrada por permiso. */
export function navegacionPara(permisos: readonly string[]) {
  const p = new Set(permisos)
  const permitido = (i: ItemNav) => !i.permiso || p.has(i.permiso)
  const perfil = perfilDe(permisos)
  const { movil, lateral } = NAVEGACION[perfil]
  return {
    perfil,
    movil: movil.filter(permitido),
    lateral: lateral.filter(permitido),
    puedeReportar: p.has(REPORTAR.permiso!),
  }
}
