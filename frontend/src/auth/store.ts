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
  /** Mensaje para la pantalla de login (p. ej. "Tu sesión expiró"); se limpia al iniciar sesión. */
  aviso: string | null
  iniciarSesion: (token: string, usuario: Usuario) => void
  cerrarSesion: (aviso?: string) => void
  tiene: (permiso: string) => boolean
}

export const useAuth = create<AuthState>((set, get) => ({
  token: null,
  usuario: null,
  aviso: null,
  iniciarSesion: (token, usuario) => set({ token, usuario, aviso: null }),
  cerrarSesion: (aviso) => set({ token: null, usuario: null, aviso: aviso ?? null }),
  tiene: (permiso) => get().usuario?.permisos.includes(permiso) ?? false,
}))
