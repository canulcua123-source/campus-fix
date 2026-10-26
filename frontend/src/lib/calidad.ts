/**
 * Control de calidad de la foto (T-051, docs/algoritmo-foto-ia.md §1.4 paso 3): sobre una copia gris de 512 px
 * calcula la varianza del Laplaciano (nitidez) y el brillo medio. El resultado es un aviso NO bloqueante
 * y viaja al servidor como pista `calidad_cliente` (compuerta G4).
 */

export const CALIDADES_CLIENTE = ['borrosa', 'oscura', 'sobreexpuesta'] as const
export type CalidadCliente = (typeof CALIDADES_CLIENTE)[number]

export interface UmbralesCalidad {
  /** var(Laplaciano) en gris 0–255 a 512 px por debajo ⇒ posible borrosa. */
  umbralNitidez: number
  /** Luminancia media por debajo ⇒ muy oscura. */
  umbralOscuro: number
  /** Luminancia media por encima ⇒ sobreexpuesta. */
  umbralSobreexpuesto: number
}

export interface Calidad {
  /** Varianza del Laplaciano (más alto = más nítida). */
  nitidez: number
  /** Luminancia media 0–255. */
  brillo: number
  borrosa: boolean
  oscura: boolean
  sobreexpuesta: boolean
}

export interface ImagenGris {
  px: Float32Array
  ancho: number
  alto: number
}

/** Luminancia BT.601 de un búfer RGBA (como el de `getImageData`). */
export function aEscalaDeGrises(rgba: ArrayLike<number>, ancho: number, alto: number): ImagenGris {
  const px = new Float32Array(ancho * alto)
  for (let i = 0, j = 0; j < px.length; i += 4, j++) px[j] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]
  return { px, ancho, alto }
}

/** Varianza del Laplaciano (kernel 4 vecinos [0,1,0;1,-4,1;0,1,0]) y brillo medio. O(ancho·alto). */
export function medirCalidad({ px, ancho, alto }: ImagenGris, umbrales: UmbralesCalidad): Calidad {
  let sumaL = 0
  let sumaL2 = 0
  let n = 0
  let sumaB = 0
  for (let i = 0; i < px.length; i++) sumaB += px[i]
  for (let y = 1; y < alto - 1; y++) {
    for (let x = 1; x < ancho - 1; x++) {
      const i = y * ancho + x
      const l = px[i - ancho] + px[i + ancho] + px[i - 1] + px[i + 1] - 4 * px[i]
      sumaL += l
      sumaL2 += l * l
      n++
    }
  }
  const media = n ? sumaL / n : 0
  const nitidez = n ? sumaL2 / n - media * media : 0
  const brillo = px.length ? sumaB / px.length : 0
  return {
    nitidez: Math.round(nitidez),
    brillo: Math.round(brillo),
    borrosa: nitidez < umbrales.umbralNitidez,
    oscura: brillo < umbrales.umbralOscuro,
    sobreexpuesta: brillo > umbrales.umbralSobreexpuesto,
  }
}

/** Pistas para `calidad_cliente` (vacío si la foto pasa). */
export function pistasCalidad(c: Calidad): CalidadCliente[] {
  return CALIDADES_CLIENTE.filter((pista) => c[pista])
}

const TEXTOS: Record<CalidadCliente, string> = {
  borrosa: 'parece borrosa',
  oscura: 'está muy oscura',
  sobreexpuesta: 'tiene demasiada luz',
}

/** "La foto parece borrosa y está muy oscura." */
export function describirCalidad(pistas: readonly CalidadCliente[]): string {
  const partes = pistas.map((p) => TEXTOS[p])
  if (partes.length === 0) return ''
  const unidas = partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}`
  return `La foto ${unidas}.`
}
