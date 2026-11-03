import { aEscalaDeGrises, medirCalidad, type Calidad } from './calidad'

/**
 * Procesamiento de la foto en el cliente (T-047, docs/algoritmo-foto-ia.md §1.2 y §2.1):
 * lee las dimensiones de la cabecera → decodifica ya reducida (resizeWidth/resizeHeight) con orientación EXIF → genera derivados JPEG sin metadatos (la recodificación descarta EXIF/GPS).
 * Corre en el hilo principal o en un Web Worker (usa OffscreenCanvas si existe); ver `fotoEnSegundoPlano.ts`.
 */

export const CONFIG_FOTO = {
  ladoLargoEvidencia: 2048, calidadEvidencia: 0.85,
  ladoLargoIA: 1280, calidadIA: 0.8,
  /** Rango que acepta el servidor en /ia/analizar-imagen (MIN/MAX_LADO_IMAGEN en backend/app/core/imagen.py). */
  ladoMinimoIA: 200, ladoMaximoIA: 2600,
  ladoLargoMiniatura: 320, calidadMiniatura: 0.7,
  /** JPEG y no WebP: Safari no codifica WebP en canvas (devuelve PNG en silencio). */
  formato: 'image/jpeg' as const,
  /** Se rechaza antes de decodificar: evita agotar la memoria del teléfono. */
  maxBytesEntrada: 30 * 1024 * 1024,
  /** Si el derivado `ia` lo excede, baja la calidad en pasos de 0.1 hasta `calidadMinima`. */
  maxBytesIA: 1.5 * 1024 * 1024,
  calidadMinima: 0.6,
  /** Control de calidad (T-051) sobre una copia gris de este lado largo. */
  ladoAnalisisCalidad: 512,
  /** var(Laplaciano) < 60 ⇒ posible borrosa (ESTIMADO: calibrar con el set de evaluación). */
  umbralNitidez: 60,
  /** Brillo medio < 45 ⇒ muy oscura (ESTIMADO). */
  umbralOscuro: 45,
  /** Brillo medio > 225 ⇒ sobreexpuesta (ESTIMADO). */
  umbralSobreexpuesto: 225,
}

/** `accept` del input: JPEG primero para que iOS transcodifique HEIC a JPEG (nunca `image/heic`). */
export const ACCEPT_FOTO = 'image/jpeg,image/png,image/webp'
/** Entrada de cámara: Chrome Android ignora `capture` si `accept` lista varios tipos y abre la galería. El tipo se valida y se convierte a JPEG después. */
export const ACCEPT_CAMARA = 'image/*'

export class ErrorImagen extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorImagen'
  }
}

export interface DerivadosFoto {
  /** 2048 px, q 0.85: se sube como evidencia. */
  evidencia: Blob
  /** 1280 px (corto ≥ 200, largo ≤ 2600 en panorámicas), q 0.80 (≤ 1.5 MB): se manda a /ia/analizar-imagen. */
  ia: Blob
  /** 320 px, q 0.70: vista previa. */
  miniatura: Blob
  /** Nitidez y brillo (aviso no bloqueante; pista `calidad_cliente`). */
  calidad: Calidad
  /** Dimensiones del original ya orientado. */
  ancho: number
  alto: number
}

// ---------- puertos (inyectables en pruebas) ----------

export interface MapaBits {
  readonly width: number
  readonly height: number
  close?: () => void
}

export interface Contexto2D {
  fillStyle: unknown
  imageSmoothingEnabled: boolean
  imageSmoothingQuality: ImageSmoothingQuality
  fillRect(x: number, y: number, w: number, h: number): void
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  drawImage(imagen: never, dx: number, dy: number, dw: number, dh: number): void
  getImageData(x: number, y: number, w: number, h: number): { data: ArrayLike<number> }
}

export interface Lienzo {
  width: number
  height: number
  getContext(tipo: '2d'): Contexto2D | null
  convertToBlob?: (opciones: { type: string; quality: number }) => Promise<Blob>
  toBlob?: (cb: (b: Blob | null) => void, tipo: string, calidad: number) => void
}

export interface TamanoDecodificacion { ancho: number; alto: number }

export interface EntornoImagen {
  /** Con `tamano`, pide al navegador decodificar ya reducido (no carga los 48–200 MP en memoria). */
  decodificar(archivo: Blob, tamano?: TamanoDecodificacion): Promise<MapaBits>
  crearLienzo(ancho: number, alto: number): Lienzo
}

export function entornoNavegador(): EntornoImagen {
  return {
    async decodificar(archivo, tamano) {
      if (typeof createImageBitmap !== 'function') throw new ErrorImagen('Tu navegador no puede procesar fotos. Actualízalo e intenta de nuevo.')
      if (tamano) {
        try {
          return await createImageBitmap(archivo, {
            imageOrientation: 'from-image', resizeWidth: tamano.ancho, resizeHeight: tamano.alto, resizeQuality: 'high',
          })
        } catch {
          // Navegador sin soporte de resizeWidth/resizeHeight: se decodifica completa abajo.
        }
      }
      try {
        // 'from-image' aplica la orientación EXIF (valor por defecto según la especificación).
        return await createImageBitmap(archivo, { imageOrientation: 'from-image' })
      } catch {
        throw new ErrorImagen('Formato de foto no soportado. Toma la foto desde la cámara o elige un JPEG, PNG o WebP.')
      }
    },
    crearLienzo(ancho, alto) {
      const lienzo = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(ancho, alto)
        : Object.assign(document.createElement('canvas'), { width: ancho, height: alto })
      return lienzo as unknown as Lienzo
    },
  }
}

// ---------- EXIF / JPEG (solo lectura de cabeceras) ----------

const BYTES_CABECERA = 256 * 1024

/** Orientación EXIF (1–8) de un JPEG; 1 si no hay EXIF o no es JPEG. */
export function leerOrientacionExif(bytes: Uint8Array): number {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let p = 2
  while (p + 4 <= bytes.length) {
    if (bytes[p] !== 0xff) return 1
    const marcador = bytes[p + 1]
    if (marcador === 0xda || marcador === 0xd9) return 1 // inicio de datos o fin: no hubo EXIF
    const largo = v.getUint16(p + 2)
    if (marcador === 0xe1 && p + 10 <= bytes.length && v.getUint32(p + 4) === 0x45786966) {
      return orientacionTiff(v, p + 10, Math.min(bytes.length, p + 2 + largo))
    }
    p += 2 + largo
  }
  return 1
}

function orientacionTiff(v: DataView, inicio: number, fin: number): number {
  if (inicio + 8 > fin) return 1
  const le = v.getUint16(inicio) === 0x4949
  const ifd = inicio + v.getUint32(inicio + 4, le)
  if (ifd + 2 > fin) return 1
  const entradas = v.getUint16(ifd, le)
  for (let i = 0; i < entradas; i++) {
    const e = ifd + 2 + i * 12
    if (e + 12 > fin) return 1
    if (v.getUint16(e, le) === 0x0112) {
      const o = v.getUint16(e + 8, le)
      return o >= 1 && o <= 8 ? o : 1
    }
  }
  return 1
}

/** Ancho y alto almacenados en el marcador SOF de un JPEG (sin aplicar orientación). */
export function leerDimensionesJpeg(bytes: Uint8Array): { ancho: number; alto: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let p = 2
  while (p + 9 <= bytes.length) {
    if (bytes[p] !== 0xff) return null
    const m = bytes[p + 1]
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { alto: v.getUint16(p + 5), ancho: v.getUint16(p + 7) }
    }
    if (m === 0xda || m === 0xd9) return null
    p += 2 + v.getUint16(p + 2)
  }
  return null
}

/** Ancho y alto de un PNG (IHDR) o WebP (VP8/VP8L/VP8X) sin decodificar; null si no se reconoce. */
function leerDimensionesPngWebp(bytes: Uint8Array): { ancho: number; alto: number } | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const texto = (i: number, n: number) => String.fromCharCode(...bytes.subarray(i, i + n))
  if (bytes.length >= 24 && bytes[0] === 0x89 && texto(1, 3) === 'PNG' && texto(12, 4) === 'IHDR') {
    return { ancho: v.getUint32(16), alto: v.getUint32(20) }
  }
  if (bytes.length < 30 || texto(0, 4) !== 'RIFF' || texto(8, 4) !== 'WEBP') return null
  const trozo = texto(12, 4)
  const u24 = (i: number) => bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16)
  if (trozo === 'VP8X') return { ancho: 1 + u24(24), alto: 1 + u24(27) }
  if (trozo === 'VP8L' && bytes[20] === 0x2f) {
    const bits = v.getUint32(21, true)
    return { ancho: (bits & 0x3fff) + 1, alto: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (trozo === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { ancho: v.getUint16(26, true) & 0x3fff, alto: v.getUint16(28, true) & 0x3fff }
  }
  return null
}

/** Orientaciones 5–8 intercambian ancho y alto (fotos verticales de teléfono). */
export const intercambiaEjes = (orientacion: number) => orientacion >= 5 && orientacion <= 8

/** Dimensiones del original ya orientado leídas de la cabecera (sin decodificar); null si no se pueden leer. */
export function leerDimensionesOrientadas(bytes: Uint8Array): { ancho: number; alto: number } | null {
  const d = leerDimensionesJpeg(bytes) ?? leerDimensionesPngWebp(bytes)
  if (!d || d.ancho < 1 || d.alto < 1) return null
  return intercambiaEjes(leerOrientacionExif(bytes)) ? { ancho: d.alto, alto: d.ancho } : d
}

/**
 * Orientación que falta aplicar al mapa de bits. Los navegadores actuales ya la aplican al decodificar;
 * si el mapa llega con las dimensiones crudas de una foto vertical (5–8), se rota aquí.
 */
function orientacionPendiente(bytes: Uint8Array, mapa: MapaBits): number {
  const o = leerOrientacionExif(bytes)
  if (!intercambiaEjes(o)) return 1
  const crudo = leerDimensionesJpeg(bytes)
  if (!crudo || crudo.ancho === crudo.alto) return 1
  return mapa.width === crudo.ancho && mapa.height === crudo.alto ? o : 1
}

/** Matriz para dibujar la imagen cruda (ancho w × alto h ya escalados) con la orientación EXIF `o`. */
function matrizOrientacion(o: number, w: number, h: number): [number, number, number, number, number, number] {
  switch (o) {
    case 2: return [-1, 0, 0, 1, w, 0]
    case 3: return [-1, 0, 0, -1, w, h]
    case 4: return [1, 0, 0, -1, 0, h]
    case 5: return [0, 1, 1, 0, 0, 0]
    case 6: return [0, 1, -1, 0, h, 0]
    case 7: return [0, -1, -1, 0, h, w]
    case 8: return [0, -1, 1, 0, 0, w]
    default: return [1, 0, 0, 1, 0, 0]
  }
}

// ---------- derivados ----------

/** Escala para que el lado largo no pase de `ladoLargo` (nunca amplía). */
export function medidasDerivado(ancho: number, alto: number, ladoLargo: number) {
  const escala = Math.min(1, ladoLargo / Math.max(ancho, alto))
  return { ancho: Math.max(1, Math.round(ancho * escala)), alto: Math.max(1, Math.round(alto * escala)), escala }
}

interface Medidas { ancho: number; alto: number; escala: number }

/**
 * Medidas del derivado `ia`: lado largo ≤ `ladoLargoIA`, pero el corto nunca baja de `ladoMinimoIA`
 * (una panorámica se deja más larga, hasta `ladoMaximoIA`). null si la proporción no cabe en ese rango.
 */
export function medidasDerivadoIA(ancho: number, alto: number, cfg = CONFIG_FOTO): Medidas | null {
  const largo = Math.max(ancho, alto)
  const corto = Math.min(ancho, alto)
  const escala = Math.max(Math.min(1, cfg.ladoLargoIA / largo), cfg.ladoMinimoIA / corto)
  const m = { ancho: Math.round(ancho * escala), alto: Math.round(alto * escala), escala }
  if (Math.max(m.ancho, m.alto) > cfg.ladoMaximoIA || Math.min(m.ancho, m.alto) < cfg.ladoMinimoIA) return null
  return m
}

/** Tamaño al que conviene decodificar: el mayor que pida algún derivado (evidencia o ia), nunca más que el original. */
export function medidasDecodificacion(ancho: number, alto: number, cfg = CONFIG_FOTO): Medidas {
  const escalaIA = medidasDerivadoIA(ancho, alto, cfg)?.escala ?? 0
  const escala = Math.min(1, Math.max(cfg.ladoLargoEvidencia / Math.max(ancho, alto), escalaIA))
  return { ancho: Math.max(1, Math.round(ancho * escala)), alto: Math.max(1, Math.round(alto * escala)), escala }
}

export const MENSAJE_FOTO_ALARGADA = 'La foto es demasiado alargada o pequeña para analizarla. Toma una foto normal (no panorámica) de la falla.'

interface Fuente { mapa: MapaBits; orientacion: number; ancho: number; alto: number }

const coincide = (mapa: MapaBits, ancho: number, alto: number) =>
  Math.abs(mapa.width - ancho) <= 1 && Math.abs(mapa.height - alto) <= 1

/**
 * Decodifica ya reducido cuando se conoce el tamaño. Si el navegador ignoró el redimensionado se usa el mapa completo;
 * si lo aplicó sin orientar (ejes cruzados, imagen deformada) se descarta y se decodifica completa.
 */
async function decodificarAjustada(
  entorno: EntornoImagen, archivo: Blob, cabecera: Uint8Array, objetivo: Medidas | null,
): Promise<{ mapa: MapaBits; orientacion: number }> {
  if (objetivo && objetivo.escala < 1) {
    const mapa = await entorno.decodificar(archivo, { ancho: objetivo.ancho, alto: objetivo.alto })
    if (coincide(mapa, objetivo.ancho, objetivo.alto)) return { mapa, orientacion: 1 }
    if (!coincide(mapa, objetivo.alto, objetivo.ancho)) return { mapa, orientacion: orientacionPendiente(cabecera, mapa) }
    mapa.close?.()
  }
  const mapa = await entorno.decodificar(archivo)
  return { mapa, orientacion: orientacionPendiente(cabecera, mapa) }
}

/** Dibuja directo al tamaño destino (sin lienzo a resolución completa: cuida la memoria en iOS). */
function dibujar(entorno: EntornoImagen, f: Fuente, { ancho, alto, escala }: Medidas): Lienzo {
  const lienzo = entorno.crearLienzo(ancho, alto)
  const ctx = lienzo.getContext('2d')
  if (!ctx) throw new ErrorImagen('No se pudo procesar la foto en este dispositivo.')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = 'white' // PNG con transparencia → fondo blanco en JPEG
  ctx.fillRect(0, 0, ancho, alto)
  const w = Math.round(f.mapa.width * escala)
  const h = Math.round(f.mapa.height * escala)
  ctx.setTransform(...matrizOrientacion(f.orientacion, w, h))
  ctx.drawImage(f.mapa as never, 0, 0, w, h)
  return lienzo
}

async function aBlob(lienzo: Lienzo, calidad: number): Promise<Blob> {
  const tipo = CONFIG_FOTO.formato
  const blob = lienzo.convertToBlob
    ? await lienzo.convertToBlob({ type: tipo, quality: calidad })
    : await new Promise<Blob | null>((ok) => lienzo.toBlob ? lienzo.toBlob(ok, tipo, calidad) : ok(null))
  if (!blob || blob.type !== tipo) throw new ErrorImagen('No se pudo convertir la foto a JPEG.')
  return blob
}

async function codificarConTope(lienzo: Lienzo, calidad: number, maxBytes: number, minima: number): Promise<Blob> {
  let q = calidad
  let blob = await aBlob(lienzo, q)
  while (blob.size > maxBytes && q - 0.1 >= minima - 1e-9) {
    q = Math.round((q - 0.1) * 10) / 10
    blob = await aBlob(lienzo, q)
  }
  return blob
}

/** Copia gris reducida para el control de calidad (~5–30 ms a 512 px en un teléfono medio). */
function escalaDeGrises(entorno: EntornoImagen, f: Fuente, ladoLargo: number) {
  const lienzo = dibujar(entorno, f, medidasDerivado(f.ancho, f.alto, ladoLargo))
  const ctx = lienzo.getContext('2d')
  if (!ctx) throw new ErrorImagen('No se pudo procesar la foto en este dispositivo.')
  return aEscalaDeGrises(ctx.getImageData(0, 0, lienzo.width, lienzo.height).data, lienzo.width, lienzo.height)
}

/** Valida tamaño y tipo, decodifica con orientación y genera los derivados `evidencia`, `ia` y `miniatura`. */
export async function procesarFoto(archivo: Blob, entorno: EntornoImagen = entornoNavegador(), cfg = CONFIG_FOTO): Promise<DerivadosFoto> {
  if (archivo.size > cfg.maxBytesEntrada) {
    throw new ErrorImagen('La foto pesa más de 30 MB. Toma otra foto o elige una más ligera.')
  }
  if (archivo.type && !archivo.type.startsWith('image/')) {
    throw new ErrorImagen('El archivo no es una imagen. Elige un JPEG, PNG o WebP.')
  }
  const cabecera = new Uint8Array(await archivo.slice(0, BYTES_CABECERA).arrayBuffer())
  const original = leerDimensionesOrientadas(cabecera)
  if (original && !medidasDerivadoIA(original.ancho, original.alto, cfg)) throw new ErrorImagen(MENSAJE_FOTO_ALARGADA)
  const objetivo = original && medidasDecodificacion(original.ancho, original.alto, cfg)
  const { mapa, orientacion } = await decodificarAjustada(entorno, archivo, cabecera, objetivo)
  try {
    const gira = intercambiaEjes(orientacion)
    const fuente: Fuente = {
      mapa, orientacion, ancho: gira ? mapa.height : mapa.width, alto: gira ? mapa.width : mapa.height,
    }
    const medidasIA = medidasDerivadoIA(fuente.ancho, fuente.alto, cfg)
    if (!medidasIA) throw new ErrorImagen(MENSAJE_FOTO_ALARGADA)
    const derivado = (ladoLargo: number) => dibujar(entorno, fuente, medidasDerivado(fuente.ancho, fuente.alto, ladoLargo))
    const evidencia = await aBlob(derivado(cfg.ladoLargoEvidencia), cfg.calidadEvidencia)
    const ia = await codificarConTope(dibujar(entorno, fuente, medidasIA), cfg.calidadIA, cfg.maxBytesIA, cfg.calidadMinima)
    const miniatura = await aBlob(derivado(cfg.ladoLargoMiniatura), cfg.calidadMiniatura)
    const calidad = medirCalidad(escalaDeGrises(entorno, fuente, cfg.ladoAnalisisCalidad), cfg)
    return { evidencia, ia, miniatura, calidad, ancho: original?.ancho ?? fuente.ancho, alto: original?.alto ?? fuente.alto }
  } finally {
    mapa.close?.()
  }
}
