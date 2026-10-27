import { describe, expect, it } from 'vitest'
import { ROLES_BASE, type RolBase } from '../test/roles'
import { ACCESO_RUTA, accesoDe, cumpleAcceso, navegacionPara, perfilDe, REPORTAR, type RutaApp } from './navegacion'

/** Matriz «Pantallas por rol» (docs/TAREAS.md, doc §6.5). «Reportar» es el botón central de cámara. */
const MATRIZ: Record<RolBase, { movil: string[]; lateral: string[] }> = {
  reportante: { movil: ['Inicio', 'Reportar', 'Mis reportes', 'Perfil'], lateral: ['Inicio', 'Mis reportes'] },
  tecnico: { movil: ['Bandeja', 'Buscar', 'Reportar', 'Perfil'], lateral: ['Bandeja', 'Buscar', 'Mis reportes'] },
  coordinador: {
    movil: ['Tablero', 'Bandeja', 'Reportar', 'Métricas', 'Perfil'],
    lateral: ['Tablero', 'Incidencias', 'Técnicos', 'Métricas'],
  },
  directivo: { movil: ['Dashboard', 'Buscar', 'Perfil'], lateral: ['Dashboard', 'Incidencias', 'Reportes'] },
  admin: {
    movil: ['Usuarios', 'Roles', 'Categorías', 'Perfil'],
    // + Dashboard (acceso a analítica:ver) y Métricas IA (T-030, exclusiva del rol admin), fuera de la tabla original.
    lateral: ['Dashboard', 'Usuarios', 'Roles', 'Categorías', 'Edificios', 'Auditoría', 'Configuración', 'Métricas IA'],
  },
}

/** Ruta × rol (✔) de docs/revision-acceso/pantallas.md. */
const RUTAS_POR_ROL: Record<RutaApp, RolBase[]> = {
  '/': ['reportante', 'tecnico', 'coordinador', 'directivo', 'admin'],
  '/perfil': ['reportante', 'tecnico', 'coordinador', 'directivo', 'admin'],
  '/reportar': ['reportante', 'tecnico', 'coordinador', 'admin'],
  '/mis-reportes': ['reportante', 'tecnico', 'coordinador', 'directivo', 'admin'],
  '/incidencias/:id': ['reportante', 'tecnico', 'coordinador', 'directivo', 'admin'],
  '/bandeja': ['tecnico', 'coordinador', 'admin'],
  '/buscar': ['tecnico', 'coordinador', 'directivo', 'admin'],
  '/tablero': ['coordinador', 'admin'],
  '/tecnicos': ['coordinador', 'admin'],
  '/dashboard': ['coordinador', 'directivo', 'admin'],
  '/reportes': ['coordinador', 'directivo', 'admin'],
  '/admin/usuarios': ['admin'],
  '/admin/roles': ['admin'],
  '/admin/categorias': ['admin'],
  '/admin/edificios': ['admin'],
  '/admin/auditoria': ['admin'],
  '/admin/configuracion': ['admin'],
  '/admin/metricas-ia': ['admin'],
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

  it('un rol personalizado con analítica pero sin rol admin no ve Métricas IA', () => {
    const permisos = [...ROLES_BASE.admin.permisos]
    expect(perfilDe(permisos)).toBe('admin')
    expect(etiquetas(navegacionPara(permisos, 'admin_campus').lateral)).not.toContain('Métricas IA')
  })
})
