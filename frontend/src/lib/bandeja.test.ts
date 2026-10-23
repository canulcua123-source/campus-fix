import { describe, expect, it } from 'vitest'
import type { IncidenciaListaItem } from '../schemas/incidencia'
import { antiguedad, filtrarBandeja, ordenarBandeja } from './bandeja'

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
    expect(filtrarBandeja(lista, 'sin_asignar', 'Ana').map((i) => i._id)).toEqual(['sin'])
    expect(filtrarBandeja(lista, 'mias', 'Ana').map((i) => i._id)).toEqual(['mia'])
  })

  it('estado vacío devuelve una lista vacía', () => {
    expect(filtrarBandeja([], 'mias', 'Ana')).toEqual([])
    expect(filtrarBandeja([], 'sin_asignar', 'Ana')).toEqual([])
  })

  it('marca la antigüedad de atención a partir de 8 h y vencida a partir de 24 h', () => {
    const ahora = new Date('2026-10-05T10:00:00Z').getTime()
    expect(antiguedad('2026-10-05T05:00:00Z', ahora)).toEqual({ texto: 'Hace 5 h', nivel: 'normal' })
    expect(antiguedad('2026-10-04T20:00:00Z', ahora).nivel).toBe('atencion')
    expect(antiguedad('2026-10-03T10:00:00Z', ahora)).toEqual({ texto: 'Hace 2 d', nivel: 'vencida' })
  })
})
