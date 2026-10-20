import { create } from 'zustand'

export type Alcance = 'propio' | 'area' | 'edificio' | 'global'

export interface Usuario {
  nombre: string
  rol: string
  permisos: string[]
  alcance: Alcance
}

interface AuthState {
  token: string | null // solo en memoria: nunca en localStorage
  usuario: Usuario | null
  iniciarSesion: (token: string, usuario: Usuario) => void
  cerrarSesion: () => void
  tiene: (permiso: string) => boolean
}

export const useAuth = create<AuthState>((set, get) => ({
  token: null,
  usuario: null,
  iniciarSesion: (token, usuario) => set({ token, usuario }),
  cerrarSesion: () => set({ token: null, usuario: null }),
  tiene: (permiso) => get().usuario?.permisos.includes(permiso) ?? false,
}))
