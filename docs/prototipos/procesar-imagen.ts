/**
 * PROTOTIPO DE REFERENCIA — NO CONECTADO A LA APP.
 * Pipeline de cliente descrito en docs/algoritmo-foto-ia.md (sección 2.1):
 *   decodificar con orientación EXIF → derivados JPEG sin metadatos → control de calidad → hashes.
 * Funciona en hilo principal o en un Web Worker (usa OffscreenCanvas si existe).
 */

export const CONFIG_FOTO = {
  ladoLargoEvidencia: 2048, calidadEvidencia: 0.85,
  ladoLargoIA: 1280, calidadIA: 0.8,
  ladoLargoMiniatura: 320, calidadMiniatura: 0.7,
  formato: 'image/jpeg' as const, // Safari no codifica WebP en canvas (devuelve PNG)
  maxBytesEntrada: 30 * 1024 * 1024,
  maxBytesIA: 1.5 * 1024 * 1024,
  calidadMinima: 0.6,
  ladoAnalisisCalidad: 512,
  umbralNitidez: 60, // ESTIMADO: calibrar con el set de evaluación
  umbralOscuro: 45, // ESTIMADO
  umbralSobreexpuesto: 225, // ESTIMADO
}

export interface Calidad {
  nitidez: number // varianza del Laplaciano
  brillo: number // luminancia media 0-255
  borrosa: boolean
  oscura: boolean
  sobreexpuesta: boolean
}

export interface FotoProcesada {
  evidencia: Blob
  ia: Blob
  miniatura: Blob
  ancho: number // dimensiones ya orientadas del original
  alto: number
  calidad: Calidad
  sha256IA: string // hex
  dhash: string // 16 hex (64 bits), para casi-duplicados
}

type Lienzo = HTMLCanvasElement | OffscreenCanvas
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export class ErrorImagen extends Error {}

export async function procesarFoto(archivo: Blob, cfg = CONFIG_FOTO): Promise<FotoProcesada> {
  if (archivo.size > cfg.maxBytesEntrada) throw new ErrorImagen('La foto es demasiado grande')
  const bitmap = await decodificar(archivo)
  try {
    const { width: ancho, height: alto } = bitmap
    const evidencia = await codificar(bitmap, cfg.ladoLargoEvidencia, cfg.calidadEvidencia)
    const ia = await codificarConTope(bitmap, cfg.ladoLargoIA, cfg.calidadIA, cfg.maxBytesIA, cfg.calidadMinima)
    const miniatura = await codificar(bitmap, cfg.ladoLargoMiniatura, cfg.calidadMiniatura)
    const gris = escalaDeGrises(bitmap, cfg.ladoAnalisisCalidad)
    const calidad = medirCalidad(gris, cfg)
    const [sha256IA, dhash] = await Promise.all([sha256Hex(ia), Promise.resolve(dHash(bitmap))])
    return { evidencia, ia, miniatura, ancho, alto, calidad, sha256IA, dhash }
  } finally {
    bitmap.close()
  }
}

/** Decodifica aplicando la orientación EXIF. Los píxeles quedan "derechos"; el EXIF se pierde al recodificar. */
async function decodificar(archivo: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(archivo, { imageOrientation: 'from-image' })
  } catch {
    // Respaldo (navegadores antiguos / formatos raros): <img> aplica image-orientation: from-image por defecto.
    if (typeof document === 'undefined') throw new ErrorImagen('Formato no soportado')
    const url = URL.createObjectURL(archivo)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return await createImageBitmap(img)
    } catch {
      throw new ErrorImagen('Formato no soportado. Toma la foto desde la cámara.')
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

function crearLienzo(w: number, h: number): [Lienzo, Ctx2D] {
  const c: Lienzo = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h })
  const ctx = c.getContext('2d', { willReadFrequently: false }) as Ctx2D | null
  if (!ctx) throw new ErrorImagen('Canvas no disponible')
  return [c, ctx]
}

function medidas(bitmap: ImageBitmap, ladoLargo: number) {
  const escala = Math.min(1, ladoLargo / Math.max(bitmap.width, bitmap.height)) // nunca amplía
  return { w: Math.round(bitmap.width * escala), h: Math.round(bitmap.height * escala) }
}

/** Dibuja directo al tamaño destino (sin canvas a resolución completa: cuida la memoria en iOS). */
function dibujar(bitmap: ImageBitmap, ladoLargo: number): Lienzo {
  const { w, h } = medidas(bitmap, ladoLargo)
  const [c, ctx] = crearLienzo(w, h)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#fff' // PNG con transparencia → fondo blanco en JPEG
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bitmap, 0, 0, w, h)
  return c
}

async function aBlob(c: Lienzo, calidad: number): Promise<Blob> {
  const blob = 'convertToBlob' in c
    ? await c.convertToBlob({ type: CONFIG_FOTO.formato, quality: calidad })
    : await new Promise<Blob | null>((ok) => (c as HTMLCanvasElement).toBlob(ok, CONFIG_FOTO.formato, calidad))
  if (!blob || blob.type !== CONFIG_FOTO.formato) throw new ErrorImagen('No se pudo codificar la imagen')
  return blob
}

async function codificar(bitmap: ImageBitmap, ladoLargo: number, calidad: number): Promise<Blob> {
  return aBlob(dibujar(bitmap, ladoLargo), calidad)
}

/** Baja la calidad en pasos de 0.1 hasta caber en maxBytes (no reduce resolución). */
async function codificarConTope(bitmap: ImageBitmap, ladoLargo: number, calidad: number, maxBytes: number, minima: number) {
  const c = dibujar(bitmap, ladoLargo)
  let q = calidad
  let blob = await aBlob(c, q)
  while (blob.size > maxBytes && q - 0.1 >= minima) {
    q = Math.round((q - 0.1) * 10) / 10
    blob = await aBlob(c, q)
  }
  return blob
}

interface Gris { px: Float32Array; w: number; h: number }

/** Luminancia BT.601 sobre una copia reducida (512 px de lado largo). */
function escalaDeGrises(bitmap: ImageBitmap, ladoLargo: number): Gris {
  const { w, h } = medidas(bitmap, ladoLargo)
  const [, ctx] = crearLienzo(w, h)
  ctx.drawImage(bitmap, 0, 0, w, h)
  const rgba = ctx.getImageData(0, 0, w, h).data
  const px = new Float32Array(w * h)
  for (let i = 0, j = 0; j < px.length; i += 4, j++) px[j] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]
  return { px, w, h }
}

/** Varianza del Laplaciano (kernel 4-vecinos [0,1,0;1,-4,1;0,1,0]) y brillo medio. O(w·h), ~5-30 ms a 512 px. */
export function medirCalidad({ px, w, h }: Gris, cfg = CONFIG_FOTO): Calidad {
  let sumaL = 0, sumaL2 = 0, n = 0, sumaB = 0
  for (let i = 0; i < px.length; i++) sumaB += px[i]
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const l = px[i - w] + px[i + w] + px[i - 1] + px[i + 1] - 4 * px[i]
      sumaL += l; sumaL2 += l * l; n++
    }
  }
  const media = n ? sumaL / n : 0
  const nitidez = n ? sumaL2 / n - media * media : 0
  const brillo = px.length ? sumaB / px.length : 0
  return {
    nitidez: Math.round(nitidez),
    brillo: Math.round(brillo),
    borrosa: nitidez < cfg.umbralNitidez,
    oscura: brillo < cfg.umbralOscuro,
    sobreexpuesta: brillo > cfg.umbralSobreexpuesto,
  }
}

/** Pistas para el servidor (campo `calidad_cliente`), p. ej. "borrosa,oscura". */
export function pistasCalidad(c: Calidad): string {
  return [c.borrosa && 'borrosa', c.oscura && 'oscura', c.sobreexpuesta && 'sobreexpuesta'].filter(Boolean).join(',')
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** dHash 64 bits: 9×8 gris, compara vecinos horizontales. Distancia de Hamming ≤ 6 ≈ misma escena (estimado). */
export function dHash(bitmap: ImageBitmap): string {
  const [, ctx] = crearLienzo(9, 8)
  ctx.drawImage(bitmap, 0, 0, 9, 8)
  const d = ctx.getImageData(0, 0, 9, 8).data
  const g = (x: number, y: number) => { const i = (y * 9 + x) * 4; return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] }
  let bits = 0n
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (g(x, y) > g(x + 1, y) ? 1n : 0n)
  return bits.toString(16).padStart(16, '0')
}

export function distanciaHamming(a: string, b: string): number {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b), n = 0
  while (x) { n += Number(x & 1n); x >>= 1n }
  return n
}

/** Recorte del usuario (coordenadas normalizadas 0-1 sobre la imagen ya orientada) + rotación en múltiplos de 90°. */
export async function recortarYRotar(
  bitmap: ImageBitmap, r: { x: number; y: number; w: number; h: number }, grados: 0 | 90 | 180 | 270,
): Promise<{ bitmap: ImageBitmap; areaConservada: number }> {
  const sx = Math.round(r.x * bitmap.width), sy = Math.round(r.y * bitmap.height)
  const sw = Math.max(1, Math.round(r.w * bitmap.width)), sh = Math.max(1, Math.round(r.h * bitmap.height))
  const girado = grados === 90 || grados === 270
  const [c, ctx] = crearLienzo(girado ? sh : sw, girado ? sw : sh)
  ctx.translate(c.width / 2, c.height / 2)
  ctx.rotate((grados * Math.PI) / 180)
  ctx.drawImage(bitmap, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh)
  return { bitmap: await createImageBitmap(c), areaConservada: r.w * r.h }
}

/** Marca de zona como capa vectorial (no se quema en la imagen de evidencia ni en la de IA). */
export interface Anotacion { forma: 'circulo' | 'flecha' | 'rectangulo'; x: number; y: number; w: number; h: number; color: string }

/** Pista textual para la IA a partir de la marca: "x,y,w,h" normalizados con 3 decimales. */
export function zonaMarcada(a: Anotacion): string {
  return [a.x, a.y, a.w, a.h].map((v) => Math.min(1, Math.max(0, v)).toFixed(3)).join(',')
}
