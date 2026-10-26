import type { IncidenciaDetalle } from '../schemas/incidencia'
export const categoriasPrueba = [
  ['infraestructura', { categoria: 'infraestructura', tipo_dano: 'filtracion', riesgo_seguridad: 'alto', requiere_insumos: true, insumos: ['Sellador'], requiere_contratista: false }, 'Filtración'],
  ['computo_redes', { categoria: 'computo_redes', ip: '10.0.0.8', vlan: 20, puerto_uplink: 'Gi0/1', equipos_afectados: 3 }, '10.0.0.8'],
  ['academico', { categoria: 'academico', plataforma: 'portal_calificaciones', codigo_curso: 'MAT-101', periodo: '2026-1', estudiantes_impactados: 42 }, 'Portal de calificaciones'],
] as const
export const detallePrueba: IncidenciaDetalle = {
  puede_retirar: false,
  _id: 'abc', codigo: 'INC-DEMO-0046', titulo: 'Reporte de prueba del campus', categoria: 'infraestructura',
  estado: 'en_proceso', prioridad: 'alta', ubicacion: { edificio: 'Edificio B', piso: 2, aula: 'B-204' }, tags: [],
  fecha_creacion: '2026-10-20T09:00:00Z', reportante: { usuario_id: 'u1', nombre: 'Ana López' },
  tecnico_asignado: { usuario_id: 'u4', nombre: 'Luis Técnico actual' },
  descripcion: 'Reporte de demostración para verificar el detalle de la incidencia.',
  detalle_especifico: { categoria: 'infraestructura', tipo_dano: 'filtracion', riesgo_seguridad: 'alto', requiere_insumos: true, insumos: ['Sellador'], requiere_contratista: false },
  evidencias_adjuntas: [], horas_invertidas: 1.5,
  historial_seguimiento: [
    { fecha: '2026-10-20T12:00:00Z', usuario_id: 'u3', autor_nombre: 'Carla Coordinadora', estado_nuevo: 'en_proceso', horas: 0, comentario: 'Reasignación al técnico actual', tipo: 'asignacion' },
    { fecha: '2026-10-20T09:00:00Z', usuario_id: 'u1', autor_nombre: 'Ana López', estado_nuevo: 'abierta', horas: 0, comentario: 'Incidencia reportada' },
    { fecha: '2026-10-20T10:00:00Z', usuario_id: 'u2', autor_nombre: 'Pedro Técnico anterior', estado_nuevo: 'en_proceso', horas: 1.5, comentario: 'Inspección inicial realizada' },
  ],
}
