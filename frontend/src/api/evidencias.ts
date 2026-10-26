import { queryOptions } from '@tanstack/react-query'
import {
  evidenciaFirmaSchema, evidenciaRegistradaSchema, firmaEvidenciaOutSchema, urlEvidenciaSchema,
} from '../schemas/incidencia'
import { ApiError, api, subirArchivoFirmado, validarEntrada } from './client'
import { claves } from './keys'

const ruta = (id: string) => `/incidencias/${encodeURIComponent(id)}/evidencias`
const ESPERA_BASE_MS = 150

export interface SubidaEvidencia {
  archivo: Blob
  /** Por defecto `archivo.name` si es File, o `evidencia`. */
  nombre?: string
  /** 0..1 durante el PUT al bucket. */
  onProgreso?: (fraccion: number) => void
  /** Intentos totales del PUT al bucket (por defecto 3). */
  intentosPut?: number
  /** Intentos totales del registro (por defecto 3). */
  intentosRegistro?: number
  /** Inyectable en pruebas para no esperar el backoff. */
  esperar?: (ms: number) => Promise<void>
  /**
   * Progreso de una subida anterior. Si se reutiliza el mismo objeto al reintentar, `subirEvidencia` lo
   * actualiza y retoma desde el paso que falló: sin nueva firma si ya existe y sin repetir el PUT si ya subió.
   */
  reanudar?: ReanudarSubida
  /** Cancela la subida en curso (firma, PUT o registro). */
  signal?: AbortSignal
  /**
   * Si la firma expiró (PUT 403 del bucket o registro 400 "firma expiró"), pide una nueva y repite una sola vez
   * (FB-14.5). Desactivado por defecto: Reportar reanuda con `reanudar` y botón de reintento.
   */
  renovarFirmaExpirada?: boolean
}

export interface ReanudarSubida {
  /** Firma obtenida (paso 1); se descarta si el bucket la rechaza con 403 (expiró). */
  firma?: { evidenciaId: string; uploadUrl: string }
  /** El PUT al bucket (paso 2) ya terminó. */
  subido?: boolean
}

const esperarPorDefecto = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function transitorio(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false
  return e.codigo === 'red' || e.codigo === 'timeout' || e.status === 0 || e.status >= 500
}

async function conReintentos<T>(fn: () => Promise<T>, intentos: number, esperar: (ms: number) => Promise<void>): Promise<T> {
  const total = Math.max(1, intentos)
  let ultimo: unknown
  for (let i = 0; i < total; i++) {
    try {
      return await fn()
    } catch (e) {
      ultimo = e
      if (i === total - 1 || !transitorio(e)) throw e
      await esperar(ESPERA_BASE_MS * 2 ** i)
    }
  }
  throw ultimo
}

/**
 * Flujo de 3 pasos (FB-14): firma → PUT al bucket (Content-Type = tipo_mime, cuerpo de peso_bytes) → registro 201.
 * No modifiques/comprimas el archivo después de llamar: el tamaño y el tipo van dentro de la firma.
 */
export async function subirEvidencia(
  incidenciaId: string,
  {
    archivo, nombre, onProgreso, signal, renovarFirmaExpirada = false,
    intentosPut = 3, intentosRegistro = 3, esperar = esperarPorDefecto, reanudar = {},
  }: SubidaEvidencia,
) {
  const firma = validarEntrada(evidenciaFirmaSchema, {
    nombre_archivo: nombre ?? (archivo instanceof File ? archivo.name : 'evidencia'),
    tipo_mime: archivo.type,
    peso_bytes: archivo.size,
  })
  // Objeto (no `let`) para que TypeScript no estreche la etapa que actualiza `intento()`.
  const progreso: { etapa: 'firma' | 'put' | 'registro' } = { etapa: 'firma' }

  async function intento() {
    progreso.etapa = 'firma'
    if (!reanudar.firma) {
      const f = await api(`${ruta(incidenciaId)}/firma`, { method: 'POST', json: firma, schema: firmaEvidenciaOutSchema, signal })
      reanudar.firma = { evidenciaId: f.evidencia_id, uploadUrl: f.upload_url }
      reanudar.subido = false
    }
    const { evidenciaId, uploadUrl } = reanudar.firma
    progreso.etapa = 'put'
    if (!reanudar.subido) {
      try {
        await conReintentos(
          () => subirArchivoFirmado(uploadUrl, archivo, firma.tipo_mime, onProgreso, undefined, signal),
          intentosPut,
          esperar,
        )
        reanudar.subido = true
      } catch (e) {
        if (e instanceof ApiError && e.status === 403) reanudar.firma = undefined // firma vencida: el próximo intento firma de nuevo
        throw e
      }
    }
    progreso.etapa = 'registro'
    return conReintentos(
      () => api(ruta(incidenciaId), { method: 'POST', json: { evidencia_id: evidenciaId }, schema: evidenciaRegistradaSchema, signal }),
      intentosRegistro,
      esperar,
    )
  }

  try {
    return await intento()
  } catch (e) {
    const vencida = e instanceof ApiError && ((progreso.etapa === 'put' && e.status === 403) || (progreso.etapa === 'registro' && e.status === 400))
    if (!renovarFirmaExpirada || !vencida || signal?.aborted) throw e
    // Firma expirada: se repite una sola vez desde el paso 1.
    reanudar.firma = undefined
    reanudar.subido = false
    return intento()
  }
}

/** URL de lectura (caduca en 5 min, FB-15): pedirla al abrir y no cachearla. */
export const urlEvidenciaQuery = (incidenciaId: string, evidenciaId: string) =>
  queryOptions({
    queryKey: claves.urlEvidencia(incidenciaId, evidenciaId),
    queryFn: ({ signal }) =>
      api(`${ruta(incidenciaId)}/${encodeURIComponent(evidenciaId)}/url`, { signal, schema: urlEvidenciaSchema }),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
