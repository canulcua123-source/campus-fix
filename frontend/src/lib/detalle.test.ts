import { describe, expect, it } from 'vitest'
import type { EntradaHistorial, IncidenciaDetalle } from '../schemas/incidencia'
import {
  autorDe, datosDetalle, esImagen, esSoloLectura, formatearFecha, formatearHoras,
  mensajeErrorDetalle, ordenarHistorial, textoUbicacion,
} from './detalle'

const reportante = { usuario_id: 'u-reporta', nombre: 'Ana López' }
const tecnico = { usuario_id: 'u-tecnico', nombre: 'Luis Pech' }

function entrada(fecha: string, usuario_id = reportante.usuario_id, estado: EntradaHistorial['estado_nuevo'] = 'abierta'): EntradaHistorial {
  return { fecha, usuario_id, estado_nuevo: estado, comentario: 'Comentario', horas: 0 }
}

describe('datosDetalle', () => {
  it('renderiza el detalle polimórfico por categoría', () => {
    expect(datosDetalle({
      categoria: 'computo_redes', ip: '10.0.0.8', vlan: 20, puerto_uplink: '', equipos_afectados: 3,
    }).map((d) => d.valor)).toEqual(['10.0.0.8', '20', 'No indicado', '3'])

    const infra = datosDetalle({
      categoria: 'infraestructura', tipo_dano: 'filtracion', riesgo_seguridad: 'alto',
      requiere_insumos: true, insumos: ['Tubo', 'Sellador'], requiere_contratista: false,
    })
    expect(infra).toContainEqual({ etiqueta: 'Tipo de daño', valor: 'Filtración' })
    expect(infra).toContainEqual({ etiqueta: 'Insumos', valor: 'Tubo, Sellador' })
    expect(infra).toContainEqual({ etiqueta: 'Requiere contratista', valor: 'No' })

    expect(datosDetalle({
      categoria: 'academico', plataforma: 'portal_calificaciones', codigo_curso: 'MAT-101',
      periodo: '2026-1', estudiantes_impactados: 42,
    })).toContainEqual({ etiqueta: 'Plataforma', valor: 'Portal de calificaciones' })
  })

  it('omite la fila de insumos si la lista está vacía', () => {
    const datos = datosDetalle({
      categoria: 'infraestructura', tipo_dano: 'otro', riesgo_seguridad: 'bajo',
      requiere_insumos: true, insumos: [], requiere_contratista: true,
    })
    expect(datos.some((d) => d.etiqueta === 'Insumos')).toBe(false)
  })
})

describe('textoUbicacion y horas', () => {
  it('compone edificio, piso y aula sin dejar separadores vacíos', () => {
    expect(textoUbicacion({ edificio: 'Edificio B', piso: 2, aula: 'B-204' })).toBe('Edificio B · Piso 2 · B-204')
    expect(textoUbicacion({ edificio: 'Edificio A', piso: null, aula: 'A-101' })).toBe('Edificio A · A-101')
  })

  it('formatea horas con un decimal solo cuando hace falta', () => {
    expect(formatearHoras(0)).toBe('0 h')
    expect(formatearHoras(2)).toBe('2 h')
    expect(formatearHoras(1.5)).toBe('1.5 h')
    expect(formatearHoras(-3)).toBe('0 h')
  })
})

describe('formatearFecha', () => {
  it('devuelve texto legible y vacío para fechas inválidas', () => {
    expect(formatearFecha('2026-10-20T15:30:00Z')).toContain('2026')
    expect(formatearFecha('no-es-fecha')).toBe('')
  })
})

describe('ordenarHistorial', () => {
  it('ordena de la entrada más antigua a la más reciente sin mutar el original', () => {
    const original = [
      entrada('2026-10-20T17:10:00Z', tecnico.usuario_id, 'en_proceso'),
      entrada('2026-10-20T09:40:00Z'),
      entrada('2026-10-20T16:20:00Z', 'u-coordina', 'en_proceso'),
    ]
    const ordenado = ordenarHistorial(original)
    expect(ordenado.map((e) => e.fecha)).toEqual([
      '2026-10-20T09:40:00Z',
      '2026-10-20T16:20:00Z',
      '2026-10-20T17:10:00Z',
    ])
    expect(original[0].fecha).toBe('2026-10-20T17:10:00Z')
  })
})

describe('autorDe', () => {
  it('resuelve al usuario actual, al reportante y al técnico sin exponer ids', () => {
    expect(autorDe(entrada('2026-10-20T09:40:00Z'), { usuarioActual: reportante.usuario_id, reportante, tecnico })).toBe('Tú')
    expect(autorDe(entrada('2026-10-20T09:40:00Z'), { usuarioActual: 'otro', reportante, tecnico })).toBe('Ana López')
    expect(autorDe(entrada('2026-10-20T17:10:00Z', tecnico.usuario_id), { usuarioActual: 'otro', reportante, tecnico })).toBe('Luis Pech')
    expect(autorDe(entrada('2026-10-20T16:20:00Z', 'u-desconocido'), { usuarioActual: 'otro', reportante, tecnico })).toBe('Usuario no disponible')
    const asignacion = { ...entrada('2026-10-20T16:20:00Z', 'u-coordina'), tipo: 'asignacion' as const }
    expect(autorDe(asignacion, { usuarioActual: 'otro', reportante, tecnico })).toBe('Usuario no disponible')
  })
})

describe('esSoloLectura', () => {
  it('deja al directivo en solo lectura y habilita a técnico y coordinador', () => {
    expect(esSoloLectura(['incidencias:ver', 'analitica:ver'])).toBe(true)
    expect(esSoloLectura(['incidencias:ver', 'seguimiento:registrar'])).toBe(false)
    expect(esSoloLectura(['incidencias:ver', 'incidencias:asignar'])).toBe(false)
  })
})

describe('mensajeErrorDetalle', () => {
  it('da mensajes amigables y decide si se puede reintentar', () => {
    expect(mensajeErrorDetalle(404)).toMatchObject({ titulo: 'No encontramos esta incidencia', puedeReintentar: false })
    expect(mensajeErrorDetalle(403)).toMatchObject({ titulo: 'No tienes acceso a esta incidencia', puedeReintentar: false })
    expect(mensajeErrorDetalle(0)).toMatchObject({ titulo: 'Sin conexión', puedeReintentar: true })
    expect(mensajeErrorDetalle(500).puedeReintentar).toBe(true)
  })
})

describe('evidencias', () => {
  it('distingue imágenes de PDF', () => {
    expect(esImagen('image/jpeg')).toBe(true)
    expect(esImagen('application/pdf')).toBe(false)
  })
})

const detalleBase: IncidenciaDetalle = {
  puede_retirar: false,
  _id: '1', codigo: 'INC-2026-1020-INF-0001', titulo: 'Luminaria fundida', categoria: 'infraestructura',
  estado: 'abierta', prioridad: 'media', ubicacion: { edificio: 'B', piso: null, aula: 'B-1' }, tags: [],
  fecha_creacion: '2026-10-20T09:40:00Z', reportante,
  descripcion: 'Luminaria fundida en el pasillo',
  detalle_especifico: { categoria: 'infraestructura', tipo_dano: 'luminaria', riesgo_seguridad: 'bajo', requiere_insumos: false, requiere_contratista: false },
  evidencias_adjuntas: [], horas_invertidas: 0, historial_seguimiento: [],
}

it('el tipo de detalle conserva fecha de creación y reportante', () => {
  expect(detalleBase.reportante.nombre).toBe('Ana López')
})
