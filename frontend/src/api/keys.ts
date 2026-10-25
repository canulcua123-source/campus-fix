import type { FiltrosIncidencias } from '../schemas/incidencia'
import type { FiltrosAnalitica } from '../schemas/analitica'

/** Claves centralizadas: invalidar ['analitica'] cubre resumen, edificios y tags filtrados. */
export const claves = {
  me: ['auth', 'me'] as const,
  incidencias: ['incidencias'] as const,
  listaIncidencias: (filtros: FiltrosIncidencias = {}) => ['incidencias', limpiarFiltros(filtros)] as const,
  buscar: (q: string) => ['incidencias', 'buscar', q.trim()] as const,
  incidencia: (id: string) => ['incidencia', id] as const,
  urlEvidencia: (id: string, evidenciaId: string) => ['incidencia', id, 'evidencia', evidenciaId] as const,
  analitica: ['analitica'] as const,
  analiticaResumen: ['analitica', 'resumen'] as const,
  analiticaEdificios: ['analitica', 'edificios'] as const,
  analiticaTags: ['analitica', 'tags'] as const,
  resumenFiltrado: (f: FiltrosAnalitica = {}) => ['analitica', 'resumen', limpiarFiltrosAnalitica(f)] as const,
  edificiosFiltrados: (f: FiltrosAnalitica = {}) => ['analitica', 'edificios', limpiarFiltrosAnalitica(f)] as const,
  tagsFiltrados: (f: FiltrosAnalitica = {}) => ['analitica', 'tags', limpiarFiltrosAnalitica(f)] as const,
  categorias: ['categorias'] as const,
  roles: ['roles'] as const,
  usuarios: ['usuarios'] as const,
}

/** Quita filtros vacíos para que {} y {estado: undefined} compartan caché. */
export function limpiarFiltros(f: FiltrosIncidencias): FiltrosIncidencias {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== null && v !== '')) as FiltrosIncidencias
}

/** Los tres pipelines reciben la misma combinación de filtros. */
export function limpiarFiltrosAnalitica(f: FiltrosAnalitica): FiltrosAnalitica {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== '')) as FiltrosAnalitica
}