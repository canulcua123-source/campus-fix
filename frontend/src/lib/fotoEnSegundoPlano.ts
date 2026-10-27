import { ErrorImagen, procesarFoto, type DerivadosFoto } from './imagen'
import type { RespuestaWorkerFoto } from './imagen.worker'

/**
 * Procesa la foto en un Web Worker si el navegador tiene OffscreenCanvas (la UI sigue respondiendo);
 * si no, o si el worker falla al arrancar, lo hace en el hilo principal.
 * (Archivo aparte de `imagen.ts` para que el worker no se incluya a sí mismo.)
 */
export async function procesarFotoEnSegundoPlano(archivo: Blob): Promise<DerivadosFoto> {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return procesarFoto(archivo)
  let respuesta: RespuestaWorkerFoto | null = null
  try {
    respuesta = await new Promise<RespuestaWorkerFoto>((resolve, reject) => {
      const worker = new Worker(new URL('./imagen.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent<RespuestaWorkerFoto>) => {
        worker.terminate()
        resolve(e.data)
      }
      worker.onerror = (e) => {
        worker.terminate()
        reject(e)
      }
      worker.postMessage(archivo)
    })
  } catch {
    return procesarFoto(archivo) // el worker no pudo iniciar: se procesa aquí
  }
  if (respuesta.ok) return respuesta.derivados
  if (respuesta.esErrorImagen) throw new ErrorImagen(respuesta.mensaje)
  return procesarFoto(archivo)
}
