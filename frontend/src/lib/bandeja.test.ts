import { describe, expect, it } from 'vitest'
import type { IncidenciaListaItem } from '../schemas/incidencia'
import { antiguedad, esVistaBandeja, filtrarBandeja, filtrarVista, ordenarBandeja, unirIncidencias } from './bandeja'

const base = {
  categoria: 'computo_redes' as const,
  estado: 'abierta' as const,
  ubicacion: { edificio: 'A', aula: 'A-101' },
  tags: [],
}

const incidencias: IncidenciaListaItem[] = [
  { ...base, _id: '1', codigo: 'INC-1', titulo: 'Baja antigua', prioridad: 'baja', fecha_creacion: '2026-10-01T10:00:00Z' },
  { ...base, _id: '2', codigo: 'INC-2', titulo: 'Alta reciente', prioridad: 'alta', fecha_creacion: '2026-10-03T10:00:00Z' },
  { ...base, _id: '3', codigo: 'INC-3', titulo: 'Crítica', prioridad: 'critica', fecha_creacion: '2026-10-02T10:00:00Z' },
  { ...base, _id: '4', codigo: 'INC-4', titulo: 'Alta antigua', prioridad: 'alta', fecha_creacion: '2026-10-02T08:00:00Z' },
  { ...base, _id: '5', codigo: 'INC-5', titulo: 'Media', prioridad: 'media', fecha_creacion: '2026-10-04T10:00:00Z' },
]

describe('Bandeja del técnico', () => {
  it('ordena por prioridad y antiguedad', () => {
    expect(ordenarBandeja(incidencias).map((i) => i._id)).toEqual(['3', '4', '2', '5', '1'])
  })

  it('pestaña sin asignar solo muestra incidencias sin técnico', () => {
    const lista: IncidenciaListaItem[] = [
      { ...incidencias[0], _id: 'sin', tecnico_asignado: undefined },
      { ...incidencias[1], _id: 'mia', tecnico_asignado: { usuario_id: 'u1', nombre: 'Ana' } },
      { ...incidencias[2], _id: 'otra', tecnico_asignado: { usuario_id: 'u2', nombre: 'Luis' } },
    ]
    expect(filtrarBandeja(lista, 'sin_asignar', 'u1').map((i) => i._id)).toEqual(['sin'])
    expect(filtrarBandeja(lista, 'mias', 'u1').map((i) => i._id)).toEqual(['mia'])
  })

  it('mías se determina por id de usuario, no por nombre', () => {
    const lista: IncidenciaListaItem[] = [
      { ...incidencias[0], _id: 'homonimo', tecnico_asignado: { usuario_id: 'u2', nombre: 'Ana' } },
      { ...incidencias[1], _id: 'mia', tecnico_asignado: { usuario_id: 'u1', nombre: 'Ana' } },
    ]
    expect(filtrarBandeja(lista, 'mias', 'u1').map((i) => i._id)).toEqual(['mia'])
    expect(filtrarBandeja(lista, 'mias', undefined)).toEqual([])
  })

  it('excluye resueltas, cerradas y retiradas', () => {
    const lista: IncidenciaListaItem[] = [
      { ...incidencias[0], _id: 'abierta', estado: 'abierta' },
      { ...incidencias[1], _id: 'proceso', estado: 'en_proceso' },
      { ...incidencias[2], _id: 'espera', estado: 'en_espera' },
      { ...incidencias[3], _id: 'resuelta', estado: 'resuelta' },
      { ...incidencias[4], _id: 'cerrada', estado: 'cerrada' },
      { ...incidencias[0], _id: 'retirada', estado: 'retirada' },
    ]
    expect(filtrarBandeja(lista, 'sin_asignar', 'u1').map((i) => i._id)).toEqual(['abierta', 'proceso', 'espera'])
  })

  it('estado vacío devuelve una lista vacía', () => {
    expect(filtrarBandeja([], 'mias', 'u1')).toEqual([])
    expect(filtrarBandeja([], 'sin_asignar', 'u1')).toEqual([])
  })

  it('marca la antigüedad de atención a partir de 8 h y vencida a partir de 24 h', () => {
    const ahora = new Date('2026-10-05T10:00:00Z').getTime()
    expect(antiguedad('2026-10-05T05:00:00Z', ahora)).toEqual({ texto: 'Hace 5 h', nivel: 'normal' })
    expect(antiguedad('2026-10-04T20:00:00Z', ahora).nivel).toBe('atencion')
    expect(antiguedad('2026-10-03T10:00:00Z', ahora)).toEqual({ texto: 'Hace 2 d', nivel: 'vencida' })
  })
})

describe('Vistas de «Mis incidencias»', () => {
  const inc = (id: string, extra: Partial<IncidenciaListaItem> = {}): IncidenciaListaItem => ({
    ...base, _id: id, codigo: id, titulo: id, prioridad: 'media', fecha_creacion: '2026-10-20T08:00:00Z', ...extra,
  })
  const mia = { usuario_id: 'u1', nombre: 'Yo' }
  const lista = [
    inc('cerrada-mia', { estado: 'cerrada', tecnico_asignado: mia }),
    inc('mia', { tecnico_asignado: mia }),
    inc('libre', { prioridad: 'critica' }),
    inc('resuelta-mia', { estado: 'resuelta', tecnico_asignado: mia }),
    inc('ajena', { tecnico_asignado: { usuario_id: 'u2', nombre: 'Otro' } }),
  ]
  const ids = (l: IncidenciaListaItem[]) => l.map((i) => i._id)
  const reportadas = new Set(['ajena', 'cerrada-mia'])

  it('separa cada vista', () => {
    expect(ids(filtrarVista(lista, 'asignadas', 'u1', reportadas))).toEqual(['mia'])
    expect(ids(filtrarVista(lista, 'por_tomar', 'u1', reportadas))).toEqual(['libre'])
    expect(ids(filtrarVista(lista, 'resueltas', 'u1', reportadas))).toEqual(['resuelta-mia'])
    expect(ids(filtrarVista(lista, 'reportadas', 'u1', reportadas))).toEqual(['ajena', 'cerrada-mia'])
  })

  it('«todas» pone primero las pendientes por prioridad', () => {
    expect(ids(filtrarVista(lista, 'todas', 'u1', reportadas))).toEqual(['libre', 'mia', 'ajena', 'cerrada-mia', 'resuelta-mia'])
  })

  it('une listas sin duplicar y valida la vista de la URL', () => {
    expect(ids(unirIncidencias([inc('a'), inc('b')], [inc('b'), inc('c')]))).toEqual(['a', 'b', 'c'])
    expect(esVistaBandeja('por_tomar')).toBe(true)
    expect(esVistaBandeja('otra')).toBe(false)
  })
})
