import { describe, expect, it } from 'vitest'
import { filtrarSugerencias, normalizarTag, validarTag } from './tags'

describe('tags (T-053)', () => {
    it("normaliza 'Cableado Dañado' a 'cableado_danado'", () => {
        expect(normalizarTag('  Cableado  Dañado  ')).toBe('cableado_danado')
        expect(validarTag('Cableado Dañado')).toEqual({ valido: true, tag: 'cableado_danado' })
    })

    it('rechaza 1 caracter', () => {
        expect(validarTag('x').valido).toBe(false)
        expect(validarTag(' ').valido).toBe(false)
    })

    it('acepta exactamente los límites de 2 y 30 caracteres', () => {
        expect(validarTag('ab')).toEqual({ valido: true, tag: 'ab' })
        expect(validarTag('a'.repeat(30))).toEqual({ valido: true, tag: 'a'.repeat(30) })
    })

    it('rechaza más de 30 caracteres y símbolos no admitidos', () => {
        expect(validarTag('a'.repeat(31)).valido).toBe(false)
        expect(validarTag('cableado-daño').valido).toBe(false)
        expect(validarTag('red_5g').valido).toBe(true)
    })

    it('usa sugerencias sin duplicados, omite etiquetas existentes y respeta el orden del backend', () => {
        const frecuentes = [
            { tag: 'wifi', total: 9 },
            { tag: 'cableado_danado', total: 8 },
            { tag: 'Cableado Dañado', total: 7 },
            { tag: 'cableado_roto', total: 6 },
            { tag: 'x', total: 5 },
        ]
        expect(filtrarSugerencias(frecuentes, ['wifi'], 'Cableado')).toEqual(['cableado_danado', 'cableado_roto'])
    })
})
