import { afterEach, describe, expect, it, vi } from 'vitest'
import { contieneTexto, jpegConExif } from './__fixtures__/jpeg'
import {
  CONFIG_FOTO, ErrorImagen, entornoNavegador, leerDimensionesJpeg, leerDimensionesOrientadas, leerOrientacionExif,
  medidasDecodificacion, medidasDerivado, medidasDerivadoIA, procesarFoto,
  type Contexto2D, type EntornoImagen, type Lienzo, type MapaBits, type TamanoDecodificacion,
} from './imagen'

interface Dibujo { ancho: number; alto: number; matriz: number[]; dibujado: [number, number] }

/**
 * Doble del navegador: `decodificar` devuelve un mapa de bits con las dimensiones indicadas y cada lienzo
 * codifica un JPEG "falso" (SOI + JSON con lo que se dibujó + EOI), sin cabeceras EXIF.
 */
function entornoFalso(mapa: { width: number; height: number }, alDecodificar?: (tamano?: TamanoDecodificacion) => MapaBits) {
  const dibujos: Dibujo[] = []
  const pedidos: (TamanoDecodificacion | undefined)[] = []
  const entorno: EntornoImagen = {
    decodificar: async (_archivo, tamano) => {
      pedidos.push(tamano)
      return alDecodificar ? alDecodificar(tamano) : mapa
    },
    crearLienzo(ancho, alto) {
      const dibujo: Dibujo = { ancho, alto, matriz: [1, 0, 0, 1, 0, 0], dibujado: [0, 0] }
      dibujos.push(dibujo)
      const ctx: Contexto2D = {
        fillStyle: '', imageSmoothingEnabled: false, imageSmoothingQuality: 'low',
        fillRect: () => undefined,
        setTransform: (...m) => { dibujo.matriz = m },
        drawImage: (_img, _x, _y, w, h) => { dibujo.dibujado = [w, h] },
        getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(128) }),
      }
      const lienzo: Lienzo = {
        width: ancho,
        height: alto,
        getContext: () => ctx,
        convertToBlob: async ({ type, quality }) => new Blob(
          [new Uint8Array([0xff, 0xd8]), JSON.stringify({ ancho, alto, quality }), new Uint8Array([0xff, 0xd9])],
          { type },
        ),
      }
      return lienzo
    },
  }
  return { entorno, dibujos, pedidos }
}

/** Navegador que sí aplica resizeWidth/resizeHeight (y la orientación) al decodificar. */
const respetaTamano = (original: { width: number; height: number }) =>
  (tamano?: TamanoDecodificacion) => (tamano ? { width: tamano.ancho, height: tamano.alto } : original)

const foto = (bytes: Uint8Array<ArrayBuffer>, tipo = 'image/jpeg') => new Blob([bytes], { type: tipo })
const leer = async (b: Blob) => new Uint8Array(await b.arrayBuffer())
const medidasDe = async (b: Blob) => {
  const texto = new TextDecoder('latin1').decode(await leer(b))
  return JSON.parse(texto.slice(2, -2)) as { ancho: number; alto: number; quality: number }
}

describe('imagen: cabeceras JPEG', () => {
  it('lee la orientación EXIF en Intel y Motorola', () => {
    expect(leerOrientacionExif(jpegConExif({ ancho: 40, alto: 30, orientacion: 6 }))).toBe(6)
    expect(leerOrientacionExif(jpegConExif({ ancho: 40, alto: 30, orientacion: 8, motorola: true }))).toBe(8)
    expect(leerOrientacionExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(1)
  })

  it('lee las dimensiones crudas del SOF', () => {
    expect(leerDimensionesJpeg(jpegConExif({ ancho: 4032, alto: 3024 }))).toEqual({ ancho: 4032, alto: 3024 })
  })

  it('nunca amplía una imagen pequeña', () => {
    expect(medidasDerivado(800, 600, 2048)).toMatchObject({ ancho: 800, alto: 600 })
  })
})

describe('imagen: medidas (#182)', () => {
  it('derivado ia: 1280 de lado largo en una foto normal', () => {
    expect(medidasDerivadoIA(4000, 3000)).toMatchObject({ ancho: 1280, alto: 960 })
  })

  it('derivado ia: una panorámica conserva 200 px de lado corto (mínimo del servidor)', () => {
    expect(medidasDerivadoIA(12000, 1000)).toMatchObject({ ancho: 2400, alto: 200 })
    expect(medidasDerivadoIA(1000, 9000)).toMatchObject({ ancho: 200, alto: 1800 })
  })

  it('derivado ia: amplía una imagen pequeña hasta el mínimo', () => {
    expect(medidasDerivadoIA(150, 100)).toMatchObject({ ancho: 300, alto: 200 })
  })

  it('derivado ia: null si la proporción no cabe en 200–2600 px', () => {
    expect(medidasDerivadoIA(30000, 1000)).toBeNull()
    expect(medidasDerivadoIA(2700, 200)).toBeNull()
  })

  it('decodificación: 48 MP se decodifica al lado de la evidencia, no completa', () => {
    expect(medidasDecodificacion(8000, 6000)).toMatchObject({ ancho: 2048, alto: 1536 })
    expect(medidasDecodificacion(16320, 12240)).toMatchObject({ ancho: 2048, alto: 1536 })
  })

  it('decodificación: una panorámica conserva lo que pida el derivado ia; nunca amplía', () => {
    expect(medidasDecodificacion(12000, 1000)).toMatchObject({ ancho: 2400, alto: 200 })
    expect(medidasDecodificacion(1000, 800)).toMatchObject({ ancho: 1000, alto: 800, escala: 1 })
  })

  it('lee dimensiones orientadas de JPEG y PNG sin decodificar', () => {
    expect(leerDimensionesOrientadas(jpegConExif({ ancho: 4032, alto: 3024, orientacion: 6 }))).toEqual({ ancho: 3024, alto: 4032 })
    const png = new Uint8Array(24)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
    new DataView(png.buffer).setUint32(16, 9000)
    new DataView(png.buffer).setUint32(20, 6000)
    expect(leerDimensionesOrientadas(png)).toEqual({ ancho: 9000, alto: 6000 })
    expect(leerDimensionesOrientadas(new Uint8Array([1, 2, 3]))).toBeNull()
  })
})

describe('entornoNavegador: decodificación reducida (#182)', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('pide resizeWidth/resizeHeight con orientación EXIF y calidad alta', async () => {
    const crear = vi.fn(async () => ({ width: 2048, height: 1536 }))
    vi.stubGlobal('createImageBitmap', crear)
    await entornoNavegador().decodificar(new Blob(['x']), { ancho: 2048, alto: 1536 })
    expect(crear).toHaveBeenCalledWith(expect.any(Blob), {
      imageOrientation: 'from-image', resizeWidth: 2048, resizeHeight: 1536, resizeQuality: 'high',
    })
  })

  it('si el navegador no soporta las opciones de redimensión, decodifica sin ellas', async () => {
    const crear = vi.fn()
      .mockRejectedValueOnce(new TypeError('opción no soportada'))
      .mockResolvedValueOnce({ width: 8000, height: 6000 })
    vi.stubGlobal('createImageBitmap', crear)
    const mapa = await entornoNavegador().decodificar(new Blob(['x']), { ancho: 2048, alto: 1536 })
    expect(mapa).toEqual({ width: 8000, height: 6000 })
    expect(crear).toHaveBeenLastCalledWith(expect.any(Blob), { imageOrientation: 'from-image' })
  })
})

describe('procesarFoto (T-047)', () => {
  it('genera 3 derivados con lado maximo', async () => {
    const { entorno } = entornoFalso({ width: 4000, height: 3000 })
    const r = await procesarFoto(foto(jpegConExif({ ancho: 4000, alto: 3000 })), entorno)

    expect(await medidasDe(r.evidencia)).toMatchObject({ ancho: 2048, alto: 1536, quality: 0.85 })
    expect(await medidasDe(r.ia)).toMatchObject({ ancho: 1280, alto: 960, quality: 0.8 })
    expect(await medidasDe(r.miniatura)).toMatchObject({ ancho: 320, alto: 240, quality: 0.7 })
    expect(r).toMatchObject({ ancho: 4000, alto: 3000 })
  })

  it('mide la calidad sobre una copia de 512 px (T-051)', async () => {
    const { entorno, dibujos } = entornoFalso({ width: 4000, height: 3000 })
    const r = await procesarFoto(foto(jpegConExif({ ancho: 4000, alto: 3000 })), entorno)

    expect(dibujos.at(-1)).toMatchObject({ ancho: 512, alto: 384 })
    expect(r.calidad).toMatchObject({ brillo: 128, borrosa: true, oscura: false, sobreexpuesta: false })
  })

  it('salida jpeg', async () => {
    const { entorno } = entornoFalso({ width: 1000, height: 1000 })
    const r = await procesarFoto(foto(jpegConExif({ ancho: 1000, alto: 1000 }), 'image/png'), entorno)

    for (const derivado of [r.evidencia, r.ia, r.miniatura]) {
      expect(derivado.type).toBe(CONFIG_FOTO.formato)
      expect([...(await leer(derivado)).slice(0, 2)]).toEqual([0xff, 0xd8])
    }
  })

  it('rechaza un lienzo que no codifica JPEG (Safari devuelve PNG)', async () => {
    const { entorno } = entornoFalso({ width: 100, height: 100 })
    const crear = entorno.crearLienzo
    entorno.crearLienzo = (w, h) => ({ ...crear(w, h), convertToBlob: async () => new Blob(['x'], { type: 'image/png' }) })

    await expect(procesarFoto(foto(jpegConExif({ ancho: 100, alto: 100 })), entorno)).rejects.toBeInstanceOf(ErrorImagen)
  })

  it('sin exif', async () => {
    const original = jpegConExif({ ancho: 200, alto: 150, orientacion: 1, gps: true })
    expect(contieneTexto(original, 'Exif')).toBe(true)
    const { entorno } = entornoFalso({ width: 200, height: 150 })

    const entrada = foto(original)
    const r = await procesarFoto(entrada, entorno)

    for (const derivado of [r.evidencia, r.ia, r.miniatura]) {
      const bytes = await leer(derivado)
      expect(derivado).not.toBe(entrada) // siempre se recodifica, aunque ya sea pequeña
      expect(contieneTexto(bytes, 'Exif')).toBe(false)
      expect(leerOrientacionExif(bytes)).toBe(1)
    }
  })

  it('corrige orientacion 6 cuando el navegador entrega los píxeles sin rotar', async () => {
    // Foto vertical de teléfono: sensor 4032×3024 con EXIF 6 (girar 90° a la derecha).
    const { entorno, dibujos } = entornoFalso({ width: 4032, height: 3024 })
    const r = await procesarFoto(foto(jpegConExif({ ancho: 4032, alto: 3024, orientacion: 6 })), entorno)

    expect(r).toMatchObject({ ancho: 3024, alto: 4032 })
    expect(await medidasDe(r.evidencia)).toMatchObject({ ancho: 1536, alto: 2048 })
    const evidencia = dibujos[0]
    expect(evidencia.dibujado).toEqual([2048, 1536]) // se dibuja la imagen cruda escalada…
    expect(evidencia.matriz).toEqual([0, 1, -1, 0, 1536, 0]) // …rotada 90° dentro del lienzo vertical
  })

  it('no rota dos veces si el navegador ya aplicó la orientación 6', async () => {
    const { entorno, dibujos } = entornoFalso({ width: 3024, height: 4032 })
    const r = await procesarFoto(foto(jpegConExif({ ancho: 4032, alto: 3024, orientacion: 6 })), entorno)

    expect(r).toMatchObject({ ancho: 3024, alto: 4032 })
    expect(dibujos[0].matriz).toEqual([1, 0, 0, 1, 0, 0])
  })

  it('rechaza mayor a 30MB sin decodificar', async () => {
    let decodificadas = 0
    const { entorno } = entornoFalso({ width: 10, height: 10 })
    entorno.decodificar = async () => {
      decodificadas += 1
      return { width: 10, height: 10 }
    }
    const enorme = new Blob([new Uint8Array(CONFIG_FOTO.maxBytesEntrada + 1)], { type: 'image/jpeg' })

    await expect(procesarFoto(enorme, entorno)).rejects.toThrow(/30 MB/)
    expect(decodificadas).toBe(0)
  })

  it('rechaza archivos que no son imagen', async () => {
    const { entorno } = entornoFalso({ width: 10, height: 10 })
    await expect(procesarFoto(new Blob(['%PDF'], { type: 'application/pdf' }), entorno)).rejects.toBeInstanceOf(ErrorImagen)
  })

  it('decodifica una foto de 48 MP ya reducida (#182)', async () => {
    const { entorno, pedidos, dibujos } = entornoFalso({ width: 0, height: 0 }, respetaTamano({ width: 8000, height: 6000 }))
    const r = await procesarFoto(foto(jpegConExif({ ancho: 8000, alto: 6000 })), entorno)

    expect(pedidos).toEqual([{ ancho: 2048, alto: 1536 }])
    expect(dibujos[0]).toMatchObject({ ancho: 2048, alto: 1536, matriz: [1, 0, 0, 1, 0, 0] })
    expect(await medidasDe(r.ia)).toMatchObject({ ancho: 1280, alto: 960 })
    expect(r).toMatchObject({ ancho: 8000, alto: 6000 })
  })

  it('foto vertical (EXIF 6): pide el tamaño ya orientado y no vuelve a rotar', async () => {
    const { entorno, pedidos, dibujos } = entornoFalso({ width: 0, height: 0 }, respetaTamano({ width: 6000, height: 8000 }))
    const r = await procesarFoto(foto(jpegConExif({ ancho: 8000, alto: 6000, orientacion: 6 })), entorno)

    expect(pedidos).toEqual([{ ancho: 1536, alto: 2048 }])
    expect(dibujos[0].matriz).toEqual([1, 0, 0, 1, 0, 0])
    expect(r).toMatchObject({ ancho: 6000, alto: 8000 })
  })

  it('si el navegador redimensiona sin orientar (ejes cruzados), decodifica completa y rota', async () => {
    const { entorno, pedidos, dibujos } = entornoFalso({ width: 0, height: 0 }, (tamano) =>
      tamano ? { width: tamano.alto, height: tamano.ancho } : { width: 8000, height: 6000 })
    const r = await procesarFoto(foto(jpegConExif({ ancho: 8000, alto: 6000, orientacion: 6 })), entorno)

    expect(pedidos).toEqual([{ ancho: 1536, alto: 2048 }, undefined])
    expect(dibujos[0].matriz).toEqual([0, 1, -1, 0, 1536, 0])
    expect(await medidasDe(r.evidencia)).toMatchObject({ ancho: 1536, alto: 2048 })
  })

  it('panorámica: el derivado ia conserva 200 px de lado corto (#182)', async () => {
    const { entorno } = entornoFalso({ width: 0, height: 0 }, respetaTamano({ width: 12000, height: 1000 }))
    const r = await procesarFoto(foto(jpegConExif({ ancho: 12000, alto: 1000 })), entorno)

    expect(await medidasDe(r.ia)).toMatchObject({ ancho: 2400, alto: 200 })
    expect(await medidasDe(r.evidencia)).toMatchObject({ ancho: 2048, alto: 171 })
  })

  it('panorámica imposible de analizar: ErrorImagen antes de decodificar (#182)', async () => {
    const { entorno, pedidos } = entornoFalso({ width: 30000, height: 1000 })
    await expect(procesarFoto(foto(jpegConExif({ ancho: 30000, alto: 1000 })), entorno)).rejects.toThrow(/alargada/)
    expect(pedidos).toHaveLength(0)
  })

  it('panorámica sin cabecera legible: ErrorImagen tras decodificar', async () => {
    const { entorno } = entornoFalso({ width: 30000, height: 1000 })
    await expect(procesarFoto(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }), entorno)).rejects.toBeInstanceOf(ErrorImagen)
  })

  it('baja la calidad del derivado ia hasta caber en el tope', async () => {
    const { entorno } = entornoFalso({ width: 4000, height: 3000 })
    const r = await procesarFoto(foto(jpegConExif({ ancho: 4000, alto: 3000 })), entorno, { ...CONFIG_FOTO, maxBytesIA: 10 })

    expect((await medidasDe(r.ia)).quality).toBe(CONFIG_FOTO.calidadMinima)
  })
})
