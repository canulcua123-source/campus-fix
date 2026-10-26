import { describe, expect, it } from 'vitest'
import { describirCalidad, medirCalidad, pistasCalidad, type ImagenGris } from './calidad'
import { CONFIG_FOTO } from './imagen'

const LADO = 128

/** Imagen sintética en gris de LADO×LADO a partir de una función de píxel. */
function sintetica(f: (x: number, y: number) => number): ImagenGris {
  const px = new Float32Array(LADO * LADO)
  for (let y = 0; y < LADO; y++) for (let x = 0; x < LADO; x++) px[y * LADO + x] = f(x, y)
  return { px, ancho: LADO, alto: LADO }
}

// Tablero de 4 px: bordes duros, brillo medio 128.
const nitida = () => sintetica((x, y) => ((Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 228 : 28))
// Degradado suave: mismo brillo medio, sin bordes (Laplaciano ≈ 0).
const desenfocada = () => sintetica((x) => 28 + (200 * x) / (LADO - 1))

describe('calidad (T-051)', () => {
  it('nitida pasa', () => {
    const c = medirCalidad(nitida(), CONFIG_FOTO)
    expect(c).toMatchObject({ borrosa: false, oscura: false, sobreexpuesta: false })
    expect(pistasCalidad(c)).toEqual([])
  })

  it('desenfocada detectada', () => {
    const c = medirCalidad(desenfocada(), CONFIG_FOTO)
    expect(c.borrosa).toBe(true)
    expect(c.oscura).toBe(false)
    expect(pistasCalidad(c)).toEqual(['borrosa'])
  })

  it('negra detectada', () => {
    const c = medirCalidad(sintetica(() => 0), CONFIG_FOTO)
    expect(c.oscura).toBe(true)
    expect(c.brillo).toBe(0)
    expect(pistasCalidad(c)).toContain('oscura')
  })

  it('blanca detectada', () => {
    const c = medirCalidad(sintetica(() => 255), CONFIG_FOTO)
    expect(c.sobreexpuesta).toBe(true)
    expect(pistasCalidad(c)).toContain('sobreexpuesta')
  })

  it('describe las pistas en español', () => {
    expect(describirCalidad(['borrosa'])).toBe('La foto parece borrosa.')
    expect(describirCalidad(['borrosa', 'oscura'])).toBe('La foto parece borrosa y está muy oscura.')
  })
})
