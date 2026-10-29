import {
  BarChart3, BrainCircuit, Building2, Camera, ClipboardList, FileText, Gauge, History, Home, Inbox, KanbanSquare, LayoutDashboard,
  ListChecks, Search, Settings, Shield, Tags, UserRound, Users, Wrench, type LucideIcon,
} from 'lucide-react'

/**
 * Navegación por rol: matriz «Pantallas por rol» de docs/TAREAS.md (detalle en docs/revision-acceso/pantallas.md).
 * El perfil se deduce de los permisos del usuario (no del nombre del rol) y cada
 * elemento se filtra además por su propio permiso (UX-31). La seguridad real está en la API.
 */
export type PerfilNav = 'reportante' | 'tecnico' | 'coordinador' | 'directivo' | 'admin' | 'superadmin'

export interface ItemNav {
  to: string
  etiqueta: string
  icono: LucideIcon
  /** Permiso requerido; sin permiso = basta con tener sesión. */
  permiso?: string
  /** Rol(es) exigido(s) además del permiso (solo Métricas IA, igual que `require_admin`). */
  rol?: string | readonly string[]
}

/** Roles de sistema que pasan `require_admin` en el backend (security.py::ROLES_ADMINISTRADORES). */
export const ROLES_ADMINISTRADORES = ['admin', 'superadmin'] as const
/** Permiso exclusivo del superadmin (backend: security.py::PERMISO_SUPERADMIN). */
export const PERMISO_SUPERADMIN = 'sistema:administrar'

/**
 * Matriz ruta → acceso (docs/revision-acceso/pantallas.md). App.tsx protege cada ruta con estos
 * mismos valores y el menú los reutiliza: una sola fuente para guardas y pestañas.
 * Sin `permiso` = basta con tener sesión. `rol` replica `require_admin` del backend (admin o superadmin).
 */
export const ACCESO_RUTA = {
  '/': {},
  '/control': { permiso: 'sistema:administrar' },
  '/perfil': {},
  '/reportar': { permiso: 'incidencias:crear' },
  '/mis-reportes': { permiso: 'incidencias:ver' },
  '/incidencias': { permiso: 'incidencias:buscar' },
  '/incidencias/:id': { permiso: 'incidencias:ver' },
  '/bandeja': { permiso: 'seguimiento:registrar' },
  '/buscar': { permiso: 'incidencias:buscar' },
  '/tablero': { permiso: 'incidencias:asignar' },
  '/tecnicos': { permiso: 'incidencias:asignar' },
  '/dashboard': { permiso: 'analitica:ver' },
  '/reportes': { permiso: 'analitica:ver' },
  '/admin/usuarios': { permiso: 'usuarios:gestionar' },
  '/admin/roles': { permiso: 'roles:gestionar' },
  '/admin/categorias': { permiso: 'categorias:gestionar' },
  '/admin/edificios': { permiso: 'usuarios:gestionar' },
  '/admin/auditoria': { permiso: 'usuarios:gestionar' },
  '/admin/configuracion': { permiso: 'configuracion:gestionar' },
  '/admin/metricas-ia': { permiso: 'analitica:ver', rol: ROLES_ADMINISTRADORES },
} as const satisfies Record<string, Acceso>

export interface Acceso {
  permiso?: string
  rol?: string | readonly string[]
}
export type RutaApp = keyof typeof ACCESO_RUTA

/** Acceso exigido por una ruta concreta (`/incidencias/abc` → `/incidencias/:id`); null si no está en la matriz. */
export function accesoDe(pathname: string): Acceso | null {
  const limpia = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (limpia in ACCESO_RUTA) return ACCESO_RUTA[limpia as RutaApp]
  if (/^\/incidencias\/[^/]+$/.test(limpia)) return ACCESO_RUTA['/incidencias/:id']
  return null
}

/** true si unos permisos y rol cumplen un acceso de la matriz. */
export function cumpleAcceso(acceso: Acceso, permisos: readonly string[], rol?: string): boolean {
  if (acceso.permiso && !permisos.includes(acceso.permiso)) return false
  if (acceso.rol) {
    const roles: readonly string[] = typeof acceso.rol === 'string' ? [acceso.rol] : acceso.rol
    if (!rol || !roles.includes(rol)) return false
  }
  return true
}

const item = (to: RutaApp, etiqueta: string, icono: LucideIcon): ItemNav => ({ to, etiqueta, icono, ...ACCESO_RUTA[to] })

/** Marcador del botón central de cámara (Reportar) en la barra inferior. */
export const REPORTAR: ItemNav = item('/reportar', 'Reportar', Camera)

const I = {
  inicio: item('/', 'Inicio', Home),
  control: item('/control', 'Centro de control', Gauge),
  controlCorto: item('/control', 'Control', Gauge),
  misReportes: item('/mis-reportes', 'Mis reportes', ClipboardList),
  perfil: item('/perfil', 'Perfil', UserRound),
  bandeja: item('/bandeja', 'Bandeja', Inbox),
  misIncidencias: item('/bandeja', 'Mis incidencias', Inbox),
  buscar: item('/buscar', 'Buscar', Search),
  tablero: item('/tablero', 'Tablero', KanbanSquare),
  metricas: item('/dashboard', 'Métricas', BarChart3),
  dashboard: item('/dashboard', 'Dashboard', LayoutDashboard),
  incidencias: item('/incidencias', 'Incidencias', ListChecks),
  tecnicos: item('/tecnicos', 'Técnicos', Wrench),
  reportes: item('/reportes', 'Reportes', FileText),
  usuarios: item('/admin/usuarios', 'Usuarios', Users),
  roles: item('/admin/roles', 'Roles', Shield),
  categorias: item('/admin/categorias', 'Categorías', Tags),
  edificios: item('/admin/edificios', 'Edificios', Building2),
  auditoria: item('/admin/auditoria', 'Auditoría', History),
  configuracion: item('/admin/configuracion', 'Configuración', Settings),
  metricasIA: item('/admin/metricas-ia', 'Métricas IA', BrainCircuit),
}

/** Grupo del menú lateral: encabezado opcional; los `plegable` se colapsan (salvo que contengan la ruta activa). */
export interface GrupoNav {
  titulo?: string
  plegable?: boolean
  items: ItemNav[]
}

interface Config {
  /** Barra inferior (< 1024 px), en orden; REPORTAR es el botón central de cámara. Máx. 5 (UX-03). */
  movil: ItemNav[]
  /** Menú lateral (≥ 1024 px), en grupos. Perfil y Reportar van aparte. */
  lateral: GrupoNav[]
}

/** Menú sin encabezados: los roles con pocos elementos (≤ 6) no se agrupan. */
const plano = (...items: ItemNav[]): GrupoNav[] => [{ items }]

export const NAVEGACION: Record<PerfilNav, Config> = {
  reportante: { movil: [I.inicio, REPORTAR, I.misReportes, I.perfil], lateral: plano(I.inicio, I.misReportes) },
  // En escritorio la barra superior ya busca: «Buscar» solo queda en la barra inferior (móvil).
  // Pantalla única del técnico: «Mis incidencias» une Bandeja y Mis reportes (/mis-reportes redirige ahí).
  tecnico: { movil: [I.misIncidencias, I.buscar, REPORTAR, I.perfil], lateral: plano(I.misIncidencias) },
  coordinador: {
    movil: [I.tablero, I.bandeja, REPORTAR, I.metricas, I.perfil],
    lateral: plano(I.tablero, I.incidencias, I.tecnicos, I.metricas),
  },
  directivo: { movil: [I.dashboard, I.buscar, I.perfil], lateral: plano(I.dashboard, I.incidencias, I.reportes) },
  // Admin opera el día a día; Roles y Configuración son del superadmin (el filtro por permiso las oculta).
  admin: {
    movil: [I.usuarios, I.categorias, I.perfil],
    lateral: [
      { titulo: 'Análisis', items: [I.dashboard, I.metricasIA] },
      { titulo: 'Administración', plegable: true, items: [I.usuarios, I.categorias, I.edificios] },
      { titulo: 'Sistema', plegable: true, items: [I.auditoria] },
    ],
  },
  superadmin: {
    movil: [I.controlCorto, I.incidencias, I.usuarios, I.perfil],
    lateral: [
      { items: [I.control] },
      { titulo: 'Operación', items: [I.incidencias, I.tablero, I.tecnicos] },
      { titulo: 'Análisis', items: [I.dashboard, I.reportes, I.metricasIA] },
      { titulo: 'Administración', plegable: true, items: [I.usuarios, I.roles, I.categorias, I.edificios] },
      { titulo: 'Sistema', plegable: true, items: [I.auditoria, I.configuracion] },
    ],
  },
}

/** true si `pathname` es la ruta del elemento o una subruta suya («/» solo coincide exacta). */
export function rutaDentroDe(i: ItemNav, pathname: string): boolean {
  if (i.to === '/') return pathname === '/'
  return pathname === i.to || pathname.startsWith(`${i.to}/`)
}

export const PERFIL_ITEM = I.perfil

/** Deduce el perfil de navegación a partir de los permisos (del más amplio al más acotado). */
export function perfilDe(permisos: readonly string[]): PerfilNav {
  const p = new Set(permisos)
  if (p.has(PERMISO_SUPERADMIN)) return 'superadmin'
  if (p.has('usuarios:gestionar') || p.has('roles:gestionar') || p.has('categorias:gestionar')) return 'admin'
  if (p.has('incidencias:asignar')) return 'coordinador'
  if (p.has('seguimiento:registrar')) return 'tecnico'
  if (p.has('analitica:ver')) return 'directivo'
  return 'reportante'
}

/** Pestañas visibles para unos permisos (y rol): configuración del perfil filtrada por su acceso. */
export function navegacionPara(permisos: readonly string[], rol?: string) {
  const permitido = (i: ItemNav) => cumpleAcceso(i, permisos, rol)
  const perfil = perfilDe(permisos)
  const { movil, lateral } = NAVEGACION[perfil]
  const grupos = lateral
    .map((g) => ({ ...g, items: g.items.filter(permitido) }))
    .filter((g) => g.items.length > 0)
  return {
    perfil,
    movil: movil.filter(permitido),
    /** Menú lateral en orden, sin grupos (para rutas de inicio y comprobaciones). */
    lateral: grupos.flatMap((g) => g.items),
    grupos,
    puedeReportar: permitido(REPORTAR),
  }
}

/** Pantalla principal del rol: la primera de su menú lateral (Bandeja, Tablero, Dashboard…); «/» si no hay. */
export function rutaInicio(permisos: readonly string[], rol?: string): string {
  return navegacionPara(permisos, rol).lateral[0]?.to ?? '/'
}
