import { LIMITES } from '../schemas/incidencia'

/** "Foto IMG_1.HEIC" → "Foto IMG_1.jpg"; sin "/", "\" ni "..", máximo 120 caracteres (EvidenciaFirmaIn). */
export function nombreSeguro(nombre: string, extension?: string): string {
  let base = nombre.replace(/[/\\]/g, '_').replace(/\.{2,}/g, '.').trim() || 'evidencia'
  if (extension) base = `${base.replace(/\.[^.]*$/, '') || 'evidencia'}.${extension}`
  if (base.length > LIMITES.nombre_archivo[1]) {
    const ext = base.match(/\.[^.]{1,5}$/)?.[0] ?? ''
    base = base.slice(0, LIMITES.nombre_archivo[1] - ext.length) + ext
  }
  return base
}
