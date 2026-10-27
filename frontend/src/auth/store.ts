import { create } from 'zustand'

export type Alcance = 'propio' | 'area' | 'edificio' | 'global'

export interface Usuario {
  nombre: string
  rol: string
  permisos: string[]
  alcance: Alcance
}

interface AuthState {
  token: string | null // solo en memoria: nunca en localStorage (FB-04)
  usuario: Usuario | null
  /** Mensaje para la pantalla de login (p. ej. "Tu sesión expiró"); se limpia al iniciar sesión. */
  aviso: string | null
  /** true mientras se intenta recuperar la sesión con la cookie de refresh al abrir la app. */
  restaurando: boolean
  iniciarSesion: (token: string, usuario: Usuario) => void
  /** Sustituye el access token tras un refresh, sin tocar el usuario. */
  actualizarToken: (token: string) => void
  cerrarSesion: (aviso?: string) => void
  setRestaurando: (restaurando: boolean) => void
  tiene: (permiso: string) => boolean
}

export const useAuth = create<AuthState>((set, get) => ({
  token: null,
  usuario: null,
  aviso: null,
  restaurando: false,
  iniciarSesion: (token, usuario) => set({ token, usuario, aviso: null, restaurando: false }),
  actualizarToken: (token) => set({ token }),
  cerrarSesion: (aviso) => set({ token: null, usuario: null, aviso: aviso ?? null, restaurando: false }),
  setRestaurando: (restaurando) => set({ restaurando }),
  tiene: (permiso) => get().usuario?.permisos.includes(permiso) ?? false,
}))
