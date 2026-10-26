/** Parámetros compartidos del procesamiento de fotos de incidencias (T-047). */
export const CONFIG_IMAGEN = {
  maxBytesEntrada: 30 * 1024 * 1024,
  calidadInicial: 0.8,
  tiposEntrada: ['image/jpeg', 'image/png', 'image/webp'] as const,
} as const

export type TipoImagenEntrada = (typeof CONFIG_IMAGEN.tiposEntrada)[number]

/** Error que puede mostrarse a la persona antes de iniciar el procesamiento. */
export class ErrorImagen extends Error {}

/**
 * Rechaza archivos que el pipeline no puede procesar antes de crear un bitmap
 * o solicitar análisis a la IA. HEIC se recibe como JPEG desde el selector de
 * iOS al dejar JPEG como primera opción de `accept`.
 */
export function validarImagenEntrada(archivo: Pick<Blob, 'size' | 'type'>): asserts archivo is Blob & { type: TipoImagenEntrada } {
  if (!CONFIG_IMAGEN.tiposEntrada.includes(archivo.type as TipoImagenEntrada)) {
    throw new ErrorImagen('Formato no compatible. Usa una imagen JPEG, PNG o WebP.')
  }
  if (archivo.size > CONFIG_IMAGEN.maxBytesEntrada) {
    throw new ErrorImagen('La foto excede el límite de 30 MB.')
  }
}
