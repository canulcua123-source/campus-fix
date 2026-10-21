import { queryOptions } from '@tanstack/react-query'
import {
  evidenciaFirmaSchema, evidenciaRegistradaSchema, firmaEvidenciaOutSchema, urlEvidenciaSchema,
} from '../schemas/incidencia'
import { api, subirArchivoFirmado, validarEntrada } from './client'
import { claves } from './keys'

const ruta = (id: string) => `/incidencias/${encodeURIComponent(id)}/evidencias`

export interface SubidaEvidencia {
  archivo: Blob
  /** Por defecto `archivo.name` si es File, o `evidencia`. */
  nombre?: string
  /** 0..1 durante el PUT al bucket. */
  onProgreso?: (fraccion: number) => void
}

/**
 * Flujo de 3 pasos (FB-14): firma → PUT al bucket (Content-Type = tipo_mime, cuerpo de peso_bytes) → registro 201.
 * No modifiques/comprimas el archivo después de llamar: el tamaño y el tipo van dentro de la firma.
 */
export async function subirEvidencia(incidenciaId: string, { archivo, nombre, onProgreso }: SubidaEvidencia) {
  const firma = validarEntrada(evidenciaFirmaSchema, {
    nombre_archivo: nombre ?? (archivo instanceof File ? archivo.name : 'evidencia'),
    tipo_mime: archivo.type,
    peso_bytes: archivo.size,
  })
  const f = await api(`${ruta(incidenciaId)}/firma`, { method: 'POST', json: firma, schema: firmaEvidenciaOutSchema })
  await subirArchivoFirmado(f.upload_url, archivo, firma.tipo_mime, onProgreso)
  return api(ruta(incidenciaId), { method: 'POST', json: { evidencia_id: f.evidencia_id }, schema: evidenciaRegistradaSchema })
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
