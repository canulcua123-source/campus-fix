import {
  adhesionSchema,
  respuestaIaSchema,
  analizarImagenSchema,
  confirmarAdhesionSchema,
  type AnalizarImagenIn,
  type ConfirmarAdhesionIn,
} from '../schemas/ia'
import { TIMEOUT_IA_MS, api, validarEntrada } from './client'

interface OpcionesAnalisis {
  nombre?: string
  signal?: AbortSignal
}

/** POST /ia/analizar-imagen: multipart, timeout de 30 s y cancelación externa opcional. */
export function analizarImagen(datos: AnalizarImagenIn, opciones: OpcionesAnalisis = {}) {
  const { imagen, contexto } = validarEntrada(analizarImagenSchema, datos)
  const fd = new FormData()
  fd.append('imagen', imagen, opciones.nombre ?? 'incidencia.jpg')
  if (contexto) fd.append('contexto', contexto)
  return api('/ia/analizar-imagen', {
    method: 'POST',
    body: fd,
    timeoutMs: TIMEOUT_IA_MS,
    signal: opciones.signal,
    schema: respuestaIaSchema,
  })
}

/** Confirma una coincidencia ya emitida por G8; no crea una incidencia nueva. */
export function confirmarAdhesion(datos: ConfirmarAdhesionIn) {
  const entrada = validarEntrada(confirmarAdhesionSchema, datos)
  return api('/ia/duplicados/adhesiones', {
    method: 'POST',
    body: JSON.stringify(entrada),
    schema: adhesionSchema,
  })
}
