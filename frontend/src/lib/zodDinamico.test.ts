import { describe, expect, it } from 'vitest'
import type { CampoCategoria } from '../schemas/catalogos'
import { esquemaDetalle, limpiarDetalle, validarDetalle } from './zodDinamico'

const campo = (c: Partial<CampoCategoria> & Pick<CampoCategoria, 'nombre' | 'tipo'>): CampoCategoria => ({ requerido: true, ...c })
const cat = (campos: CampoCategoria[]) => ({ clave: 'laboratorio', campos })

describe('zodDinamico (T-061)', () => {
  it('genera esquema por tipo', () => {
    const esquema = esquemaDetalle(cat([
      campo({ nombre: 'equipo', tipo: 'texto', min: 2, max: 10 }),
      campo({ nombre: 'temperatura', tipo: 'numero', min: -10, max: 50 }),
      campo({ nombre: 'equipos', tipo: 'entero', min: 1 }),
      campo({ nombre: 'urgente', tipo: 'booleano' }),
      campo({ nombre: 'ip', tipo: 'ip' }),
    ]))
    const valido = { categoria: 'laboratorio', equipo: 'osc', temperatura: 21.5, equipos: 3, urgente: false, ip: '10.0.0.1' }
    expect(esquema.safeParse(valido).success).toBe(true)
    expect(esquema.safeParse({ ...valido, ip: '::1' }).success).toBe(true)
    expect(esquema.safeParse({ ...valido, equipo: 'x' }).success).toBe(false)
    expect(esquema.safeParse({ ...valido, temperatura: 60 }).success).toBe(false)
    expect(esquema.safeParse({ ...valido, equipos: 1.5 }).success).toBe(false)
    expect(esquema.safeParse({ ...valido, urgente: 'no' }).success).toBe(false)
    expect(esquema.safeParse({ ...valido, ip: '999.1.1.1' }).success).toBe(false)
    // Estricto como el modelo de Pydantic (extra="forbid") y con la categoría como literal.
    expect(esquema.safeParse({ ...valido, extra: 1 }).success).toBe(false)
    expect(esquema.safeParse({ ...valido, categoria: 'otra' }).success).toBe(false)
  })

  it('requerido', () => {
    const def = cat([campo({ nombre: 'serie', tipo: 'texto' }), campo({ nombre: 'nota', tipo: 'texto', requerido: false })])
    expect(validarDetalle(def, { serie: 'A1' })).toEqual({ datos: { categoria: 'laboratorio', serie: 'A1' } })
    expect(validarDetalle(def, { serie: '', nota: 'x' }).errores).toEqual({ serie: 'Este campo es obligatorio' })
    // Opcional vacío se omite: nunca se manda '' ni null.
    expect(limpiarDetalle(def, { serie: 'A1', nota: '' })).toEqual({ categoria: 'laboratorio', serie: 'A1' })
  })

  it('opciones de lista', () => {
    const def = cat([campo({ nombre: 'turno', tipo: 'lista', opciones: ['matutino', 'vespertino'] })])
    expect(validarDetalle(def, { turno: 'matutino' }).datos).toEqual({ categoria: 'laboratorio', turno: 'matutino' })
    expect(validarDetalle(def, { turno: 'nocturno' }).errores?.turno).toBe('Elige una opción de la lista')
  })
})
