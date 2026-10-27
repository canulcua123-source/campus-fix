import { describe, expect, it } from 'vitest'
import { contieneTexto, jpegConExif } from './__fixtures__/jpeg'
import {
  CONFIG_FOTO, ErrorImagen, leerDimensionesJpeg, leerOrientacionExif, medidasDerivado, procesarFoto,
  type Contexto2D, type EntornoImagen, type Lienzo,
} from './imagen'

interface Dibujo { ancho: number; alto: number; matriz: number[]; dibujado: [number, number] }

/**
 * Doble del navegador: `decodificar` devuelve un mapa de bits con las dimensiones indicadas y cada lienzo
 * codifica un JPEG "falso" (SOI + JSON con lo que se dibujó + EOI), sin cabeceras EXIF.
 */
function entornoFalso(mapa: { width: number; height: number }) {
  const dibujos: Dibujo[] = []
  const entorno: EntornoImagen = {
    decodificar: async () => mapa,
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
  return { entorno, dibujos }
}

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

  it('baja la calidad del derivado ia hasta caber en el tope', async () => {
    const { entorno } = entornoFalso({ width: 4000, height: 3000 })
    const r = await procesarFoto(foto(jpegConExif({ ancho: 4000, alto: 3000 })), entorno, { ...CONFIG_FOTO, maxBytesIA: 10 })

    expect((await medidasDe(r.ia)).quality).toBe(CONFIG_FOTO.calidadMinima)
  })
})
