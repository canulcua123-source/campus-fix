import { describe, expect, it } from 'vitest'
import type { IncidenciaListaItem } from '../schemas/incidencia'
import { BOM, construirCsv, enPeriodo, escaparCelda, incidenciasACsv, intervaloUtc } from './csv'

describe('escaparCelda', () => {
  it('deja intactos los valores simples y vacía null/undefined', () => {
    expect(escaparCelda('Aula 3')).toBe('Aula 3')
    expect(escaparCelda(-2)).toBe('-2')
    expect(escaparCelda(null)).toBe('')
    expect(escaparCelda(undefined)).toBe('')
  })

  it('entrecomilla comas, comillas, saltos de línea y espacios extremos', () => {
    expect(escaparCelda('a,b')).toBe('"a,b"')
    expect(escaparCelda('dice "hola"')).toBe('"dice ""hola"""')
    expect(escaparCelda('línea 1\nlínea 2')).toBe('"línea 1\nlínea 2"')
    expect(escaparCelda('x\r\ny')).toBe('"x\r\ny"')
    expect(escaparCelda(' borde ')).toBe('" borde "')
  })

  it('neutraliza fórmulas de hoja de cálculo', () => {
    expect(escaparCelda('=SUMA(A1)')).toBe("'=SUMA(A1)")
    expect(escaparCelda('+1')).toBe("'+1")
    expect(escaparCelda('-1')).toBe("'-1")
    expect(escaparCelda('@cmd')).toBe("'@cmd")
    expect(escaparCelda('=HYPERLINK("x","y")')).toBe(`"'=HYPERLINK(""x"",""y"")"`)
  })
})

describe('construirCsv', () => {
  it('agrega BOM UTF-8 y usa CRLF', () => {
    const csv = construirCsv(['Título', 'Total'], [['Fuga, baño', 2], ['Wifi', 1]])
    expect(csv.startsWith(BOM)).toBe(true)
    expect(csv.slice(1)).toBe('Título,Total\r\n"Fuga, baño",2\r\nWifi,1\r\n')
  })
})

describe('incidenciasACsv', () => {
  const base: IncidenciaListaItem = {
    _id: '1', codigo: 'INF-2026-0001', titulo: 'Gotera "grande"', categoria: 'infraestructura', estado: 'en_proceso',
    prioridad: 'critica', ubicacion: { edificio: 'A', piso: 1, aula: '101' }, tags: [], fecha_creacion: '2026-10-19T14:02:00Z',
  }

  it('usa etiquetas legibles, técnico y fecha es-MX', () => {
    const [encabezados, fila] = incidenciasACsv([base]).slice(1).split('\r\n')
    expect(encabezados).toBe('Folio,Título,Categoría,Prioridad,Estado,Edificio,Piso,Aula,Técnico asignado,Fecha de creación')
    expect(fila).toContain('INF-2026-0001,"Gotera ""grande""",Infraestructura,Crítica,En proceso,A,1,101,Sin asignar,')
    expect(fila).toMatch(/19 oct 2026/)
    expect(fila).not.toContain('en_proceso')
  })
})

describe('periodo UTC', () => {
  it('incluye todo el día hasta y excluye fuera de rango', () => {
    const intervalo = intervaloUtc('2026-10-01', '2026-10-31')
    expect(enPeriodo('2026-10-01T00:00:00Z', intervalo)).toBe(true)
    expect(enPeriodo('2026-10-31T23:59:59Z', intervalo)).toBe(true)
    expect(enPeriodo('2026-11-01T00:00:00Z', intervalo)).toBe(false)
    expect(enPeriodo('2026-09-30T23:59:59Z', intervalo)).toBe(false)
    expect(enPeriodo('no-fecha', intervaloUtc())).toBe(false)
    expect(enPeriodo('2020-01-01T00:00:00Z', intervaloUtc())).toBe(true)
  })
})
