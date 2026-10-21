import { create } from 'zustand'
import { ApiError } from './client'

/**
 * Avisos globales de error de la API (para un Toast). Las mutaciones publican aquí sus errores, salvo
 * los 400 con `campos` (se muestran en el formulario) y el 401 (ya lleva a /login).
 * Para que una mutación no publique: `useMutation({ meta: { silencioso: true } })`.
 */
export interface AvisoApi {
  id: number
  mensaje: string
  codigo: ApiError['codigo'] | 'desconocido'
}

interface AvisosState {
  avisos: AvisoApi[]
  publicar: (mensaje: string, codigo?: AvisoApi['codigo']) => void
  descartar: (id: number) => void
}

let siguiente = 1
export const useAvisosApi = create<AvisosState>((set) => ({
  avisos: [],
  publicar: (mensaje, codigo = 'desconocido') =>
    set((s) => ({ avisos: [...s.avisos.filter((a) => a.mensaje !== mensaje), { id: siguiente++, mensaje, codigo }].slice(-3) })),
  descartar: (id) => set((s) => ({ avisos: s.avisos.filter((a) => a.id !== id) })),
}))

export function notificarError(e: unknown) {
  if (e instanceof ApiError) {
    if (e.codigo === 'no_autenticado') return
    if (e.codigo === 'validacion' && Object.keys(e.campos).length > 0) return
    useAvisosApi.getState().publicar(e.message, e.codigo)
    return
  }
  useAvisosApi.getState().publicar('Ocurrió un error inesperado')
}
