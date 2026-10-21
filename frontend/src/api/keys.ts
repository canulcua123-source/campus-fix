import type { FiltrosIncidencias } from '../schemas/incidencia'

/** Claves de query centralizadas (FB-09). Invalidar por prefijo: `['incidencias']` cubre lista y búsqueda. */
export const claves = {
  me: ['auth', 'me'] as const,
  incidencias: ['incidencias'] as const,
  listaIncidencias: (filtros: FiltrosIncidencias = {}) => ['incidencias', limpiarFiltros(filtros)] as const,
  buscar: (q: string) => ['incidencias', 'buscar', q.trim()] as const,
  incidencia: (id: string) => ['incidencia', id] as const,
  urlEvidencia: (id: string, evidenciaId: string) => ['incidencia', id, 'evidencia', evidenciaId] as const,
  analitica: ['analitica'] as const,
  analiticaEdificios: ['analitica', 'edificios'] as const,
  analiticaTags: ['analitica', 'tags'] as const,
  categorias: ['categorias'] as const,
  roles: ['roles'] as const,
  usuarios: ['usuarios'] as const,
}

/** Quita filtros vacíos para que `{}` y `{estado: undefined}` compartan caché. */
export function limpiarFiltros(f: FiltrosIncidencias): FiltrosIncidencias {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== null && v !== '')) as FiltrosIncidencias
}
