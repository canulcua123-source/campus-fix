import { describe, expect, it } from 'vitest'
import { TRANSICIONES, etiquetaEstado, transicionesDesde } from './estados'

describe('transiciones de incidencia', () => {
  it('coinciden con la tabla 9.4', () => {
    expect(TRANSICIONES).toEqual({
      abierta: ['en_proceso', 'en_espera'],
      en_proceso: ['en_espera', 'resuelta'],
      en_espera: ['en_proceso'],
      resuelta: ['cerrada', 'en_proceso'],
      cerrada: [],
      retirada: [],
    })
  })

  it('devuelve una lista de solo lectura y etiquetas en español', () => {
    expect(transicionesDesde('resuelta')).toEqual(['cerrada', 'en_proceso'])
    expect(etiquetaEstado('en_proceso')).toBe('En proceso')
  })
})
