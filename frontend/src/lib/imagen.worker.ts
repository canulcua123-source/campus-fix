/// Web Worker de procesamiento de foto (T-047): mantiene la UI fluida mientras se decodifica y recodifica.
import { ErrorImagen, procesarFoto, type DerivadosFoto } from './imagen'

export type RespuestaWorkerFoto =
  | { ok: true; derivados: DerivadosFoto }
  | { ok: false; mensaje: string; esErrorImagen: boolean }

const ambito = self as unknown as {
  onmessage: ((evento: MessageEvent<Blob>) => void) | null
  postMessage: (respuesta: RespuestaWorkerFoto) => void
}

ambito.onmessage = async (evento) => {
  try {
    ambito.postMessage({ ok: true, derivados: await procesarFoto(evento.data) })
  } catch (e) {
    ambito.postMessage({
      ok: false,
      mensaje: e instanceof Error ? e.message : 'No se pudo procesar la foto',
      esErrorImagen: e instanceof ErrorImagen,
    })
  }
}
