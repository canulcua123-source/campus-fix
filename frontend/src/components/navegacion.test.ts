import { describe, expect, it } from 'vitest'
import { ROLES_BASE, type RolBase } from '../test/roles'
import { ACCESO_RUTA, accesoDe, cumpleAcceso, navegacionPara, perfilDe, REPORTAR, rutaDentroDe, rutaInicio, type RutaApp } from './navegacion'

/** Matriz «Pantallas por rol» (docs/TAREAS.md, doc §6.5). «Reportar» es el botón central de cámara. */
const MATRIZ: Record<RolBase, { movil: string[]; lateral: string[] }> = {
  reportante: { movil: ['Inicio', 'Reportar', 'Mis reportes', 'Perfil'], lateral: ['Inicio', 'Mis reportes'] },
  tecnico: { movil: ['Bandeja', 'Buscar', 'Reportar', 'Perfil'], lateral: ['Bandeja', 'Mis reportes'] },
  coordinador: {
    movil: ['Tablero', 'Bandeja', 'Reportar', 'Métricas', 'Perfil'],
    lateral: ['Tablero', 'Incidencias', 'Técnicos', 'Métricas'],
  },
  directivo: { movil: ['Dashboard', 'Buscar', 'Perfil'], lateral: ['Dashboard', 'Incidencias', 'Reportes'] },
  admin: {
    // Roles y Configuración pasaron al superadmin.
    movil: ['Usuarios', 'Categorías', 'Perfil'],
    // + Dashboard (acceso a analítica:ver) y Métricas IA (T-030, exclusiva de admin/superadmin), fuera de la tabla original.
    lateral: ['Dashboard', 'Métricas IA', 'Usuarios', 'Categorías', 'Edificios', 'Auditoría'],
  },
  superadmin: {
    movil: ['Control', 'Incidencias', 'Usuarios', 'Perfil'],
    lateral: [
      'Centro de control', 'Incidencias', 'Tablero', 'Técnicos', 'Dashboard', 'Reportes', 'Métricas IA', 'Usuarios', 'Roles',
      'Categorías', 'Edificios', 'Auditoría', 'Configuración',
    ],
  },
}

/** Ruta × rol (✔) de docs/revision-acceso/pantallas.md. */
const RUTAS_POR_ROL: Record<RutaApp, RolBase[]> = {
  '/': ['reportante', 'tecnico', 'coordinador', 'directivo', 'admin', 'superadmin'],
  '/control': ['superadmin'],
  '/perfil': ['reportante', 'tecnico', 'coordinador', 'directivo', 'admin', 'superadmin'],
  '/reportar': ['reportante', 'tecnico', 'coordinador', 'admin', 'superadmin'],
  '/mis-reportes': ['reportante', 'tecnico', 'coordinador', 'directivo', 'admin', 'superadmin'],
  '/incidencias': ['tecnico', 'coordinador', 'directivo', 'admin', 'superadmin'],
  '/incidencias/:id': ['reportante', 'tecnico', 'coordinador', 'directivo', 'admin', 'superadmin'],
  '/bandeja': ['tecnico', 'coordinador', 'admin', 'superadmin'],
  '/buscar': ['tecnico', 'coordinador', 'directivo', 'admin', 'superadmin'],
  '/tablero': ['coordinador', 'admin', 'superadmin'],
  '/tecnicos': ['coordinador', 'admin', 'superadmin'],
  '/dashboard': ['coordinador', 'directivo', 'admin', 'superadmin'],
  '/reportes': ['coordinador', 'directivo', 'admin', 'superadmin'],
  '/admin/usuarios': ['admin', 'superadmin'],
  '/admin/roles': ['superadmin'],
  '/admin/categorias': ['admin', 'superadmin'],
  '/admin/edificios': ['admin', 'superadmin'],
  '/admin/auditoria': ['admin', 'superadmin'],
  '/admin/configuracion': ['superadmin'],
  '/admin/metricas-ia': ['admin', 'superadmin'],
}

const etiquetas = (items: { etiqueta: string }[]) => items.map((i) => i.etiqueta)

describe('navegacion', () => {
  it.each(Object.keys(MATRIZ) as RolBase[])('pestañas por rol igual a matriz (%s)', (rol) => {
    const { permisos } = ROLES_BASE[rol]
    const nav = navegacionPara(permisos, rol)
    expect(nav.perfil).toBe(rol)
    expect(etiquetas(nav.movil)).toEqual(MATRIZ[rol].movil)
    expect(etiquetas(nav.lateral)).toEqual(MATRIZ[rol].lateral)
    expect(nav.movil.length).toBeLessThanOrEqual(5) // UX-03
    expect(nav.puedeReportar).toBe(permisos.includes(REPORTAR.permiso!))
  })

  it('cada pestaña apunta a una ruta de la matriz con su mismo acceso', () => {
    for (const rol of Object.keys(MATRIZ) as RolBase[]) {
      const nav = navegacionPara(ROLES_BASE[rol].permisos, rol)
      for (const i of [...nav.movil, ...nav.lateral]) {
        const acceso = accesoDe(i.to)
        expect(acceso, i.to).not.toBeNull()
        expect({ permiso: i.permiso, rol: i.rol }).toEqual({ permiso: acceso!.permiso, rol: acceso!.rol })
      }
    }
  })

  it.each(Object.keys(RUTAS_POR_ROL) as RutaApp[])('ruta %s permitida solo a los roles de la matriz', (ruta) => {
    const permitidos = (Object.keys(ROLES_BASE) as RolBase[]).filter((rol) => cumpleAcceso(ACCESO_RUTA[ruta], ROLES_BASE[rol].permisos, rol))
    expect(permitidos).toEqual(RUTAS_POR_ROL[ruta])
  })

  it('accesoDe resuelve rutas con parámetro y desconocidas', () => {
    expect(accesoDe('/incidencias/abc123')).toEqual({ permiso: 'incidencias:ver' })
    expect(accesoDe('/bandeja/')).toEqual({ permiso: 'seguimiento:registrar' })
    expect(accesoDe('/no-existe')).toBeNull()
  })

  it('superadmin se detecta antes que admin y aterriza en el Centro de control', () => {
    expect(perfilDe(ROLES_BASE.superadmin.permisos)).toBe('superadmin')
    expect(perfilDe(ROLES_BASE.admin.permisos)).toBe('admin')
    expect(rutaInicio(ROLES_BASE.superadmin.permisos, 'superadmin')).toBe('/control')
    expect(rutaInicio(ROLES_BASE.admin.permisos, 'admin')).toBe('/dashboard')
  })

  it('un rol personalizado con analítica pero sin rol admin no ve Métricas IA', () => {
    const permisos = [...ROLES_BASE.admin.permisos]
    expect(perfilDe(permisos)).toBe('admin')
    expect(etiquetas(navegacionPara(permisos, 'admin_campus').lateral)).not.toContain('Métricas IA')
  })

  it('superadmin y admin ven el menú lateral agrupado; Administración y Sistema son plegables', () => {
    const resumen = (rol: RolBase) => navegacionPara(ROLES_BASE[rol].permisos, rol).grupos
      .map((g) => ({ titulo: g.titulo, plegable: !!g.plegable, items: etiquetas(g.items) }))
    expect(resumen('superadmin')).toEqual([
      { titulo: undefined, plegable: false, items: ['Centro de control'] },
      { titulo: 'Operación', plegable: false, items: ['Incidencias', 'Tablero', 'Técnicos'] },
      { titulo: 'Análisis', plegable: false, items: ['Dashboard', 'Reportes', 'Métricas IA'] },
      { titulo: 'Administración', plegable: true, items: ['Usuarios', 'Roles', 'Categorías', 'Edificios'] },
      { titulo: 'Sistema', plegable: true, items: ['Auditoría', 'Configuración'] },
    ])
    expect(resumen('admin')).toEqual([
      { titulo: 'Análisis', plegable: false, items: ['Dashboard', 'Métricas IA'] },
      { titulo: 'Administración', plegable: true, items: ['Usuarios', 'Categorías', 'Edificios'] },
      { titulo: 'Sistema', plegable: true, items: ['Auditoría'] },
    ])
  })

  it.each(['reportante', 'tecnico', 'coordinador', 'directivo'] as RolBase[])('%s (≤ 6 elementos) conserva el menú sin encabezados', (rol) => {
    const { grupos, lateral } = navegacionPara(ROLES_BASE[rol].permisos, rol)
    expect(lateral.length).toBeLessThanOrEqual(6)
    expect(grupos).toHaveLength(1)
    expect(grupos[0].titulo).toBeUndefined()
  })

  it('omite grupos sin elementos permitidos', () => {
    // Rol personalizado de perfil admin sin auditoría ni edificios (usuarios:gestionar ausente).
    const { grupos } = navegacionPara(['categorias:gestionar'], 'admin_campus')
    expect(grupos.map((g) => g.titulo)).toEqual(['Administración'])
    expect(etiquetas(grupos[0].items)).toEqual(['Categorías'])
  })

  it('rutaDentroDe reconoce subrutas pero «/» solo exacta', () => {
    const usuarios = navegacionPara(ROLES_BASE.superadmin.permisos, 'superadmin').lateral.find((i) => i.to === '/admin/usuarios')!
    expect(rutaDentroDe(usuarios, '/admin/usuarios')).toBe(true)
    expect(rutaDentroDe(usuarios, '/admin/usuarios/abc')).toBe(true)
    expect(rutaDentroDe(usuarios, '/admin/usuarios-x')).toBe(false)
    expect(rutaDentroDe({ ...usuarios, to: '/' }, '/control')).toBe(false)
  })
})
