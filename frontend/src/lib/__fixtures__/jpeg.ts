/**
 * Fixtures binarias de JPEG para las pruebas de `imagen.ts`: SOI + APP1 (EXIF con orientación y GPS) + SOF0 + EOI.
 * No contienen datos de escaneo (no se decodifican): el decodificador se sustituye por un doble en las pruebas.
 */

interface OpcionesJpeg {
  ancho: number
  alto: number
  orientacion?: number
  gps?: boolean
  /** Orden de bytes del TIFF: Intel (II, little endian) por defecto o Motorola (MM). */
  motorola?: boolean
}

export function jpegConExif({ ancho, alto, orientacion = 1, gps = true, motorola = false }: OpcionesJpeg): Uint8Array<ArrayBuffer> {
  const le = !motorola
  const entradas = gps ? 2 : 1
  const ifd0 = 8
  const ifdGps = ifd0 + 2 + entradas * 12 + 4
  const tiff = new DataView(new ArrayBuffer(ifdGps + 2 + 12 + 4))
  tiff.setUint16(0, le ? 0x4949 : 0x4d4d)
  tiff.setUint16(2, 42, le)
  tiff.setUint32(4, ifd0, le)
  tiff.setUint16(ifd0, entradas, le)
  // 0x0112 Orientation, SHORT, 1 valor
  tiff.setUint16(ifd0 + 2, 0x0112, le)
  tiff.setUint16(ifd0 + 4, 3, le)
  tiff.setUint32(ifd0 + 6, 1, le)
  tiff.setUint16(ifd0 + 10, orientacion, le)
  if (gps) {
    // 0x8825 GPSInfo, LONG → IFD GPS con GPSLatitudeRef = "N"
    tiff.setUint16(ifd0 + 14, 0x8825, le)
    tiff.setUint16(ifd0 + 16, 4, le)
    tiff.setUint32(ifd0 + 18, 1, le)
    tiff.setUint32(ifd0 + 22, ifdGps, le)
    tiff.setUint16(ifdGps, 1, le)
    tiff.setUint16(ifdGps + 2, 0x0001, le)
    tiff.setUint16(ifdGps + 4, 2, le)
    tiff.setUint32(ifdGps + 6, 2, le)
    tiff.setUint8(ifdGps + 10, 0x4e)
  }
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...new Uint8Array(tiff.buffer)]
  const app1 = [0xff, 0xe1, ...u16(exif.length + 2), ...exif]
  const sof0 = [0xff, 0xc0, ...u16(17), 8, ...u16(alto), ...u16(ancho), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]
  return new Uint8Array([0xff, 0xd8, ...app1, ...sof0, 0xff, 0xd9])
}

function u16(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff]
}

export const contieneTexto = (bytes: Uint8Array, texto: string) =>
  new TextDecoder('latin1').decode(bytes).includes(texto)
