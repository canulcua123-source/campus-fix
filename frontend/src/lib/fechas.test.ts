import { describe, expect, it } from 'vitest'
import { hoyEnMexico, rangoUltimosDias, restarDias } from './fechas'

describe('fechas en America/Mexico_City', () => {
  it('usa el día de México aunque en UTC ya sea mañana', () => {
    // 2026-10-27 03:00 UTC = 2026-10-26 21:00 en Ciudad de México
    expect(hoyEnMexico(new Date('2026-10-27T03:00:00Z'))).toBe('2026-10-26')
  })

  it('resta días cruzando meses y años', () => {
    expect(restarDias('2026-03-01', 1)).toBe('2026-02-28')
    expect(restarDias('2026-01-05', 10)).toBe('2025-12-26')
  })

  it('calcula los últimos N días incluyendo hoy', () => {
    expect(rangoUltimosDias(7, new Date('2026-10-26T18:00:00Z'))).toEqual({ desde: '2026-10-20', hasta: '2026-10-26' })
  })
})
