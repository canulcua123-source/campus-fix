import { analisisImagenSchema, analizarImagenSchema, type AnalizarImagenIn } from '../schemas/ia'
import { TIMEOUT_IA_MS, api, validarEntrada } from './client'

/** POST /ia/analizar-imagen en multipart (FB-16): sin Content-Type manual, timeout de 60 s. */
export function analizarImagen(datos: AnalizarImagenIn, nombre = 'incidencia.jpg') {
  const { imagen, contexto } = validarEntrada(analizarImagenSchema, datos)
  const fd = new FormData()
  fd.append('imagen', imagen, nombre)
  if (contexto) fd.append('contexto', contexto)
  return api('/ia/analizar-imagen', { method: 'POST', body: fd, timeoutMs: TIMEOUT_IA_MS, schema: analisisImagenSchema })
}
