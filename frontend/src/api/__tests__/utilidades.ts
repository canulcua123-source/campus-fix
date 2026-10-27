import { vi } from 'vitest'

/** Respuesta simulada de fetch. */
export function respuesta(status: number, cuerpo: unknown, cabeceras: Record<string, string> = {}) {
  const esTexto = typeof cuerpo === 'string'
  const tipo = esTexto ? 'text/html' : 'application/json'
  return new Response(esTexto ? cuerpo : JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': tipo, ...cabeceras },
  })
}

/** Sustituye fetch global por uno que devuelve las respuestas en orden (la última se repite). */
export function simularFetch(...respuestas: (() => Response)[]) {
  let i = 0
  const fn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const r = respuestas[Math.min(i, respuestas.length - 1)]
    i++
    return r()
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
