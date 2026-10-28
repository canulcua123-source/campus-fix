import { describe, expect, it, vi } from 'vitest'
import { reenviar, reescribirSetCookie, urlDestino } from '../reenviar'

const API = 'https://utm-desk-api.onrender.com'

describe('reescribirSetCookie', () => {
  it('antepone /api al Path de la cookie de refresh y conserva los demás atributos', () => {
    const c = 'refresh_token=abc; HttpOnly; Max-Age=100; Path=/auth; SameSite=lax; Secure'
    expect(reescribirSetCookie(c)).toBe('refresh_token=abc; HttpOnly; Max-Age=100; Path=/api/auth; SameSite=lax; Secure')
  })

  it('Path=/ pasa a /api; un Path con prefijo no se duplica; sin Path no cambia', () => {
    expect(reescribirSetCookie('a=1; Path=/')).toBe('a=1; Path=/api')
    expect(reescribirSetCookie('a=1; Path=/api/auth')).toBe('a=1; Path=/api/auth')
    expect(reescribirSetCookie('a=1; HttpOnly')).toBe('a=1; HttpOnly')
  })

  it('quita Domain y respeta el valor con "=" y mayúsculas en el atributo', () => {
    expect(reescribirSetCookie('a=x==; domain=onrender.com; path=/auth')).toBe('a=x==; Path=/api/auth')
  })

  it('borrado de cookie (logout) también queda bajo /api', () => {
    const c = 'refresh_token=""; expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; Path=/auth; SameSite=lax; Secure'
    expect(reescribirSetCookie(c)).toContain('Path=/api/auth')
    expect(reescribirSetCookie(c)).toContain('expires=Thu, 01 Jan 1970 00:00:00 GMT')
  })
})

describe('urlDestino', () => {
  it('quita el prefijo y conserva la query', () => {
    expect(urlDestino('https://x.pages.dev/api/auth/refresh?a=1&b=2', `${API}/`)).toBe(`${API}/auth/refresh?a=1&b=2`)
    expect(urlDestino('https://x.pages.dev/api', API)).toBe(`${API}/`)
    expect(urlDestino('https://x.pages.dev/apis/x', API)).toBe(`${API}/apis/x`)
  })
})

describe('reenviar', () => {
  it('reenvía método, cabeceras y cuerpo; reescribe Set-Cookie y quita hop-by-hop', async () => {
    const upstream = new Headers({ 'Content-Type': 'application/json', Connection: 'keep-alive' })
    upstream.append('Set-Cookie', 'refresh_token=n1; HttpOnly; Path=/auth; SameSite=lax; Secure')
    upstream.append('Set-Cookie', 'otra=2; Path=/')
    const f = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) =>
      new Response('{"access_token":"t"}', { status: 200, headers: upstream }))
    const pet = new Request('https://x.pages.dev/api/auth/refresh?x=1', {
      method: 'POST',
      headers: {
        Cookie: 'refresh_token=v', Authorization: 'Bearer a', 'Content-Type': 'application/json',
        Origin: 'https://x.pages.dev', 'CF-Connecting-IP': '1.2.3.4', 'X-Forwarded-For': '6.6.6.6', Connection: 'close',
      },
      body: '{"a":1}',
    })
    const r = await reenviar(pet, API, f as unknown as typeof fetch)

    const [url, init] = f.mock.calls[0]
    expect(url).toBe(`${API}/auth/refresh?x=1`)
    expect(init?.method).toBe('POST')
    expect(init?.redirect).toBe('manual')
    const h = new Headers(init?.headers)
    expect(h.get('cookie')).toBe('refresh_token=v')
    expect(h.get('authorization')).toBe('Bearer a')
    expect(h.get('content-type')).toBe('application/json')
    expect(h.get('origin')).toBe('https://x.pages.dev')
    expect(h.get('x-forwarded-for')).toBe('1.2.3.4')
    expect(h.get('connection')).toBeNull()
    expect(h.get('cf-connecting-ip')).toBeNull()
    expect(await new Response(init?.body).text()).toBe('{"a":1}')

    expect(r.status).toBe(200)
    expect(r.headers.get('connection')).toBeNull()
    expect(r.headers.getSetCookie()).toEqual([
      'refresh_token=n1; HttpOnly; Path=/api/auth; SameSite=lax; Secure',
      'otra=2; Path=/api',
    ])
    expect(await r.text()).toBe('{"access_token":"t"}')
  })

  it('GET sin cuerpo y Location de la API reescrito al proxy', async () => {
    const f = vi.fn(async () => new Response(null, { status: 307, headers: { Location: `${API}/incidencias/` } }))
    const r = await reenviar(new Request('https://x.pages.dev/api/incidencias'), API, f as unknown as typeof fetch)
    expect((f.mock.calls[0] as unknown[])[1]).toMatchObject({ method: 'GET', body: undefined })
    expect(r.status).toBe(307)
    expect(r.headers.get('location')).toBe('/api/incidencias/')
  })

  it('sin API_ORIGIN o con la API caída responde 502 JSON', async () => {
    const sin = await reenviar(new Request('https://x.pages.dev/api/health'), undefined)
    expect(sin.status).toBe(502)
    const caida = vi.fn(async () => {
      throw new TypeError('connect failed')
    })
    const r = await reenviar(new Request('https://x.pages.dev/api/health'), API, caida as unknown as typeof fetch)
    expect(r.status).toBe(502)
    expect(await r.json()).toEqual({ detail: 'No fue posible contactar la API' })
  })
})
