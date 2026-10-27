import { MutationCache, QueryClient } from '@tanstack/react-query'
import { notificarError } from './avisos'
import { configurarExpiracion, debeReintentar } from './client'

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: { silencioso?: boolean }
    queryMeta: { silencioso?: boolean }
  }
}

/**
 * QueryClient de la app (FB-11):
 * - queries (solo GET): reintento solo en red/timeout/5xx, máximo 2; nunca 4xx ni respuesta fuera de contrato.
 * - mutaciones: sin reintentos (un POST repetido puede duplicar una incidencia).
 * - refetchOnWindowFocus apagado por defecto; las listas lo activan en su queryOptions.
 */
export function crearQueryClient() {
  const qc = new QueryClient({
    mutationCache: new MutationCache({
      onError: (e, _v, _c, mutation) => {
        if (!mutation.meta?.silencioso) notificarError(e)
      },
    }),
    defaultOptions: {
      queries: {
        retry: debeReintentar,
        retryDelay: (intento) => Math.min(1000 * 2 ** intento, 8000),
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  })
  // 401: el cliente cierra la sesión; aquí se limpia la caché para no mostrar datos del usuario anterior (FB-05/06).
  configurarExpiracion(() => qc.clear())
  return qc
}
