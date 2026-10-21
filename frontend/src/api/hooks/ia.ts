import { useMutation } from '@tanstack/react-query'
import type { AnalizarImagenIn } from '../../schemas/ia'
import { analizarImagen } from '../ia'

/** Análisis de foto con IA. En 429/503 la página sigue con el formulario manual (RF-IA-05). */
export function useAnalizarImagen() {
  return useMutation({
    mutationFn: (datos: AnalizarImagenIn) => analizarImagen(datos),
    meta: { silencioso: true }, // la página muestra su propio aviso y continúa en manual
  })
}
