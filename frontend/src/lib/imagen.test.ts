import { describe, expect, it } from 'vitest'
import { CONFIG_IMAGEN, ErrorImagen, validarImagenEntrada } from './imagen'

describe('validarImagenEntrada', () => {
  it('acepta JPEG, PNG y WebP dentro del límite', () => {
    for (const type of CONFIG_IMAGEN.tiposEntrada) {
      expect(() => validarImagenEntrada({ size: 1024, type })).not.toThrow()
    }
  })

  it('rechaza un tipo que el pipeline no procesa', () => {
    expect(() => validarImagenEntrada({ size: 1024, type: 'image/gif' })).toThrow(ErrorImagen)
  })

  it('rechaza una foto de más de 30 MB antes de procesarla', () => {
    expect(() => validarImagenEntrada({
      size: CONFIG_IMAGEN.maxBytesEntrada + 1,
      type: 'image/jpeg',
    })).toThrow('La foto excede el límite de 30 MB.')
  })
})
