import { describe, expect, it } from 'vitest'
import headers from '../public/_headers?raw'
import indexHtml from '../index.html?raw'
import robots from '../public/robots.txt?raw'
import security from '../public/.well-known/security.txt?raw'

/**
 * CSP, robots.txt y security.txt del frontend.
 * La CSP vive en public/_headers y solo la sirve Cloudflare Pages; este test evita
 * que se relaje o se desincronice del script inline de tema sin que nadie lo note.
 */

/** Hash sha256 en base64 del script inline de tema (T-058) de index.html. */
async function hashScriptTema(): Promise<string> {
  const coincidencia = indexHtml.match(/<script>([\s\S]*?)<\/script>/)
  if (!coincidencia) throw new Error('index.html no tiene script inline de tema')
  const resumen = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(coincidencia[1]))
  return btoa(String.fromCharCode(...new Uint8Array(resumen)))
}

function csp(): string {
  const coincidencia = headers.match(/Content-Security-Policy:\s*(.+)/)
  if (!coincidencia) throw new Error('_headers no define Content-Security-Policy')
  return coincidencia[1].trim()
}

describe('cabeceras de seguridad (frontend/public/_headers)', () => {
  it('define una CSP restrictiva', async () => {
    const valor = csp()
    expect(valor).toContain("default-src 'self'")
    expect(valor).toContain(`script-src 'self' 'sha256-${await hashScriptTema()}'`)
    expect(valor).toContain("style-src 'self' 'unsafe-inline'")
    expect(valor).toContain(
      "img-src 'self' data: blob: https://*.backblazeb2.com https://*.r2.cloudflarestorage.com",
    )
    expect(valor).toContain(
      "media-src 'self' https://*.backblazeb2.com https://*.r2.cloudflarestorage.com",
    )
    expect(valor).toContain(
      "connect-src 'self' https://*.backblazeb2.com https://*.r2.cloudflarestorage.com",
    )
    expect(valor).toContain("worker-src 'self'")
    expect(valor).toContain("object-src 'none'")
    expect(valor).toContain("frame-ancestors 'none'")
    expect(valor).toContain("base-uri 'self'")
    expect(valor).toContain("form-action 'self'")
    // La API es same-origin (/api, vía Pages Function): el navegador nunca llama
    // directo a onrender.com, así que no debe aparecer en la CSP.
    expect(valor).not.toContain('onrender.com')
    // Sin comodín https: genérico: las descargas firmadas solo van a B2/R2.
    expect(valor).not.toMatch(/(^| )https:(;|$)/)
  })

  it('no relaja las demás cabeceras', () => {
    expect(headers).toContain('X-Content-Type-Options: nosniff')
    expect(headers).toContain('X-Frame-Options: DENY')
    expect(headers).toContain('Strict-Transport-Security: max-age=31536000; includeSubDomains')
  })
})

describe('robots.txt y security.txt', () => {
  it('robots.txt bloquea todo el rastreo', () => {
    expect(robots).toContain('User-agent: *')
    expect(robots).toContain('Disallow: /')
  })

  it('security.txt expone contacto sin inventar un correo', () => {
    expect(security).toContain('Contact: https://github.com/canulcua123-source/campus-fix/issues')
    expect(security).toContain('Expires: 2027-12-31T00:00:00.000Z')
    expect(security).toContain('Preferred-Languages: es')
    expect(security).not.toMatch(/@/)
  })
})
