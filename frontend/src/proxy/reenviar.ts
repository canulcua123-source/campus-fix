/**
 * Proxy same-origin de la API para Cloudflare Pages Functions (`functions/api/[[path]].ts`).
 *
 * La PWA (`*.pages.dev`) y la API (`*.onrender.com`) son sitios distintos: Safari/iOS/PWA bloquean la
 * cookie de refresh por ser de terceros. Con este proxy el navegador solo habla con su propio origen
 * (`/api/*`) y la cookie es de primera parte. Sin dependencias de Cloudflare para probarlo con vitest.
 */

export const PREFIJO_PROXY = '/api'

/** Cabeceras hop-by-hop (RFC 9110 §7.6.1) y las que fija el propio fetch. */
const SALTO = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection', 'te', 'trailer',
  'transfer-encoding', 'upgrade', 'host', 'content-length',
])

/** No se reenvían: hop-by-hop, las de Cloudflare y las X-Forwarded-* que manda el cliente (falsificables). */
const esCabeceraInterna = (nombre: string) =>
  SALTO.has(nombre) || nombre.startsWith('cf-') || nombre.startsWith('x-forwarded-') || nombre === 'x-real-ip'

/**
 * Reescribe un `Set-Cookie` de la API para que el navegador lo guarde bajo el prefijo del proxy:
 * `Path=/auth` → `Path=/api/auth` (si no, la cookie no viajaría a `/api/auth/refresh`). Quita
 * `Domain=` (sería el de onrender.com y el navegador la rechazaría). Sin `Path` la deja igual: el
 * navegador toma por defecto la carpeta de la URL pedida, que ya lleva el prefijo.
 */
export function reescribirSetCookie(valor: string, prefijo = PREFIJO_PROXY): string {
  const partes = valor.split(';')
  const salida = [partes[0]]
  for (const parte of partes.slice(1)) {
    const attr = parte.trim()
    if (!attr) continue
    const [nombre, ...resto] = attr.split('=')
    const clave = nombre.trim().toLowerCase()
    if (clave === 'domain') continue
    if (clave === 'path') {
      const ruta = resto.join('=').trim() || '/'
      const yaTienePrefijo = ruta === prefijo || ruta.startsWith(`${prefijo}/`)
      const nueva = yaTienePrefijo ? ruta : ruta === '/' ? prefijo : `${prefijo}${ruta.startsWith('/') ? '' : '/'}${ruta}`
      salida.push(` Path=${nueva}`)
      continue
    }
    salida.push(` ${attr}`)
  }
  return salida.join(';')
}

/** `/api/auth/refresh?x=1` → `https://api.onrender.com/auth/refresh?x=1`. */
export function urlDestino(urlPeticion: string, origenApi: string, prefijo = PREFIJO_PROXY): string {
  const u = new URL(urlPeticion)
  let ruta = u.pathname === prefijo || u.pathname.startsWith(`${prefijo}/`) ? u.pathname.slice(prefijo.length) : u.pathname
  if (!ruta.startsWith('/')) ruta = `/${ruta}`
  return `${origenApi.replace(/\/+$/, '')}${ruta}${u.search}`
}

function errorProxy(status: number, detalle: string): Response {
  return new Response(JSON.stringify({ detail: detalle }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

/**
 * Reenvía la petición a la API conservando método, query, cabeceras (Cookie, Authorization,
 * Content-Type, Origin…) y cuerpo en streaming; devuelve la respuesta con sus Set-Cookie reescritos.
 */
export async function reenviar(
  peticion: Request,
  origenApi: string | undefined,
  hacerFetch: typeof fetch = fetch,
): Promise<Response> {
  if (!origenApi) return errorProxy(502, 'Proxy sin API_ORIGIN configurado')
  const origen = origenApi.replace(/\/+$/, '')

  const cabeceras = new Headers()
  peticion.headers.forEach((valor, nombre) => {
    if (!esCabeceraInterna(nombre.toLowerCase())) cabeceras.set(nombre, valor)
  })
  // IP real del cliente para los límites por IP de la API (uvicorn --proxy-headers). La fija Cloudflare.
  const ip = peticion.headers.get('cf-connecting-ip')
  if (ip) cabeceras.set('X-Forwarded-For', ip)
  const urlPeticion = new URL(peticion.url)
  cabeceras.set('X-Forwarded-Host', urlPeticion.host)
  cabeceras.set('X-Forwarded-Proto', urlPeticion.protocol.replace(':', ''))

  const conCuerpo = peticion.method !== 'GET' && peticion.method !== 'HEAD'
  let resp: Response
  try {
    resp = await hacerFetch(urlDestino(peticion.url, origen), {
      method: peticion.method,
      headers: cabeceras,
      body: conCuerpo ? peticion.body : undefined,
      redirect: 'manual',
      // Necesario para cuerpos en streaming en Node/undici; Workers lo ignora.
      ...(conCuerpo ? { duplex: 'half' } : {}),
    } as RequestInit)
  } catch {
    return errorProxy(502, 'No fue posible contactar la API')
  }

  const salida = new Headers()
  resp.headers.forEach((valor, nombre) => {
    const n = nombre.toLowerCase()
    if (n !== 'set-cookie' && !SALTO.has(n)) salida.set(nombre, valor)
  })
  const cookies = typeof resp.headers.getSetCookie === 'function' ? resp.headers.getSetCookie() : []
  for (const c of cookies) salida.append('Set-Cookie', reescribirSetCookie(c))
  // Redirecciones de la API (p. ej. barra final) se mantienen dentro del proxy.
  const destino = salida.get('Location')
  if (destino?.startsWith(origen)) salida.set('Location', `${PREFIJO_PROXY}${destino.slice(origen.length) || '/'}`)

  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: salida })
}
