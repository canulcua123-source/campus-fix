import {
  adhesionSchema,
  respuestaIaSchema,
  analizarImagenSchema,
  confirmarAdhesionSchema,
  eventoIaOutSchema,
  eventoIaSchema,
  type AnalizarImagenIn,
  type ConfirmarAdhesionIn,
  type EventoIAIn,
} from '../schemas/ia'
import { TIMEOUT_IA_MS, api, validarEntrada } from './client'

interface OpcionesAnalisis {
  nombre?: string
  signal?: AbortSignal
}

/** POST /ia/analizar-imagen: multipart, timeout de 30 s y cancelación externa opcional. */
export function analizarImagen(datos: AnalizarImagenIn, opciones: OpcionesAnalisis = {}) {
  const { imagen, contexto, calidad_cliente, aula_id } = validarEntrada(analizarImagenSchema, datos)
  const fd = new FormData()
  fd.append('imagen', imagen, opciones.nombre ?? 'incidencia.jpg')
  if (contexto) fd.append('contexto', contexto)
  if (calidad_cliente?.length) fd.append('calidad_cliente', calidad_cliente.join(','))
  if (aula_id) fd.append('aula_id', aula_id)
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

/** POST /ia/eventos: la persona descartó la sugerencia (deshecho) o siguió a mano (fallback). */
export function registrarEventoIA(datos: EventoIAIn) {
  return api('/ia/eventos', {
    method: 'POST',
    json: validarEntrada(eventoIaSchema, datos),
    schema: eventoIaOutSchema,
  })
}
