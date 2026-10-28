/**
 * Cloudflare Pages Function: proxy same-origin `/api/*` → `${API_ORIGIN}/*` (Render).
 * Variable de entorno de Pages: `API_ORIGIN=https://<servicio>.onrender.com`. La lógica vive en
 * `src/proxy/reenviar.ts` (probada con vitest); aquí solo se conecta con el runtime de Pages.
 * Las Functions tienen prioridad sobre `public/_redirects` (el fallback SPA no intercepta `/api/*`).
 */
import { reenviar } from '../../src/proxy/reenviar'

interface Contexto {
  request: Request
  env: { API_ORIGIN?: string }
}

export const onRequest = ({ request, env }: Contexto): Promise<Response> => reenviar(request, env.API_ORIGIN)
