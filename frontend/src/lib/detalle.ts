import type { EntradaHistorial, IncidenciaDetalle, TipoMimeEvidencia } from '../schemas/incidencia'

export interface DatoDetalle {
  etiqueta: string
  valor: string
}

const TIPOS_DANO: Record<string, string> = {
  filtracion: 'Filtración',
  electrico: 'Eléctrico',
  climatizacion: 'Climatización',
  cerrajeria: 'Cerrajería',
  luminaria: 'Luminaria',
  otro: 'Otro',
}

const RIESGOS: Record<string, string> = { bajo: 'Bajo', medio: 'Medio', alto: 'Alto' }

const PLATAFORMAS: Record<string, string> = {
  lms: 'LMS',
  portal_calificaciones: 'Portal de calificaciones',
  correo: 'Correo institucional',
}

const siNo = (valor: boolean) => (valor ? 'Sí' : 'No')

export function datosDetalle(detalle: IncidenciaDetalle['detalle_especifico']): DatoDetalle[] {
  switch (detalle.categoria) {
    case 'computo_redes':
      return [
        { etiqueta: 'IP', valor: detalle.ip },
        { etiqueta: 'VLAN', valor: String(detalle.vlan) },
        { etiqueta: 'Puerto de uplink', valor: detalle.puerto_uplink || 'No indicado' },
        { etiqueta: 'Equipos afectados', valor: String(detalle.equipos_afectados) },
      ]
    case 'infraestructura': {
      const datos: DatoDetalle[] = [
        { etiqueta: 'Tipo de daño', valor: TIPOS_DANO[detalle.tipo_dano] ?? detalle.tipo_dano },
        { etiqueta: 'Riesgo', valor: RIESGOS[detalle.riesgo_seguridad] ?? detalle.riesgo_seguridad },
        { etiqueta: 'Requiere insumos', valor: siNo(detalle.requiere_insumos) },
      ]
      if (detalle.insumos?.length) datos.push({ etiqueta: 'Insumos', valor: detalle.insumos.join(', ') })
      datos.push({ etiqueta: 'Requiere contratista', valor: siNo(detalle.requiere_contratista) })
      return datos
    }
    case 'academico':
      return [
        { etiqueta: 'Plataforma', valor: PLATAFORMAS[detalle.plataforma] ?? detalle.plataforma },
        { etiqueta: 'Código de curso', valor: detalle.codigo_curso },
        { etiqueta: 'Periodo', valor: detalle.periodo },
        { etiqueta: 'Estudiantes impactados', valor: String(detalle.estudiantes_impactados) },
      ]
  }
}

export function textoUbicacion(ubicacion: IncidenciaDetalle['ubicacion']): string {
  const piso = ubicacion.piso == null ? null : `Piso ${ubicacion.piso}`
  return [ubicacion.edificio, piso, ubicacion.aula].filter(Boolean).join(' · ')
}

const formatoFecha = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Mexico_City',
})

export function formatearFecha(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return ''
  return formatoFecha.format(fecha)
}

export function formatearHoras(horas: number): string {
  const valor = Number.isFinite(horas) ? Math.max(0, horas) : 0
  return `${Number.isInteger(valor) ? valor : valor.toFixed(1)} h`
}

function instante(iso: string): number {
  const valor = new Date(iso).getTime()
  return Number.isNaN(valor) ? 0 : valor
}

/** Copia ordenada de más antigua a más reciente para leer la bitácora de arriba a abajo. */
export function ordenarHistorial(entradas: readonly EntradaHistorial[]): EntradaHistorial[] {
  return [...entradas].sort((a, b) => instante(a.fecha) - instante(b.fecha))
}

export interface AutoresTimeline {
  usuarioActual?: string | null
  reportante: IncidenciaDetalle['reportante']
  tecnico?: IncidenciaDetalle['tecnico_asignado']
}

export function autorDe(entrada: EntradaHistorial, autores: AutoresTimeline): string {
  if (autores.usuarioActual && entrada.usuario_id === autores.usuarioActual) return 'Tú'
  if (entrada.usuario_id === autores.reportante.usuario_id) return autores.reportante.nombre
  if (autores.tecnico && entrada.usuario_id === autores.tecnico.usuario_id) return autores.tecnico.nombre
  if (entrada.tipo === 'asignacion') return 'Coordinación'
  return 'Usuario'
}

export function esSoloLectura(permisos: readonly string[]): boolean {
  return !permisos.includes('seguimiento:registrar') && !permisos.includes('incidencias:asignar')
}

export interface ErrorDetalle {
  titulo: string
  mensaje: string
  puedeReintentar: boolean
}

export function mensajeErrorDetalle(status: number): ErrorDetalle {
  if (status === 404) {
    return {
      titulo: 'No encontramos esta incidencia',
      mensaje: 'Puede que se haya eliminado o que esté fuera de tu alcance.',
      puedeReintentar: false,
    }
  }
  if (status === 403) {
    return {
      titulo: 'No tienes acceso a esta incidencia',
      mensaje: 'Tu rol no permite ver incidencias de esta área.',
      puedeReintentar: false,
    }
  }
  if (status === 401) {
    return {
      titulo: 'Tu sesión expiró',
      mensaje: 'Inicia sesión de nuevo para continuar.',
      puedeReintentar: false,
    }
  }
  if (status === 0) {
    return {
      titulo: 'Sin conexión',
      mensaje: 'Revisa tu internet e intenta de nuevo.',
      puedeReintentar: true,
    }
  }
  return {
    titulo: 'No pudimos cargar la incidencia',
    mensaje: 'Ocurrió un problema al consultar el detalle. Intenta de nuevo.',
    puedeReintentar: true,
  }
}

export function esImagen(tipo: TipoMimeEvidencia): boolean {
  return tipo.startsWith('image/')
}
