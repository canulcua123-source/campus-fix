import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// Ejecutar Vite con VITE_API_URL=http://localhost:8000; datos sintéticos, sin backend remoto.
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const salida = new URL('../../docs/capturas/46/', import.meta.url)
await mkdir(salida, { recursive: true })
try {
  for (const [formato, width, height] of [['movil', 360, 800], ['escritorio', 1440, 1000]]) {
    for (const categoria of ['infraestructura', 'computo_redes', 'academico']) {
      const page = await browser.newPage({ viewport: { width, height } })
      page.setDefaultTimeout(15000)
      await page.goto('http://localhost:5173/login')
      const fixture = await page.evaluate(async (categoria) => {
        const { detallePrueba, categoriasPrueba } = await import('/src/test/detalle-fixture.ts')
        return { ...detallePrueba, categoria, detalle_especifico: categoriasPrueba.find(([c]) => c === categoria)[1] }
      }, categoria)
      await page.route('http://localhost:8000/**', async route => {
        const url = new URL(route.request().url())
        if (url.pathname === '/incidencias/abc') return route.fulfill({ json: fixture })
        return route.fulfill({ status: 501, json: { detail: 'Ruta no modelada en la captura' } })
      })
      await page.evaluate(async () => {
        const { useAuth } = await import('/src/auth/store.ts')
        useAuth.getState().iniciarSesion('token-sintetico-capturas', { nombre: 'Dirección de prueba', rol: 'directivo', permisos: ['incidencias:ver'], alcance: 'global' })
      })
      await page.evaluate(() => { history.pushState({}, '', '/incidencias/abc'); dispatchEvent(new PopStateEvent('popstate')) })
      await page.getByRole('heading', { name: 'Bitácora' }).waitFor()
      await page.getByText('Pedro Técnico anterior', { exact: true }).waitFor()
      const desborda = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
      if (desborda) throw new Error(`Desbordamiento en ${formato}/${categoria}`)
      await page.screenshot({ path: fileURLToPath(new URL(`${categoria}-${formato}.png`, salida)), fullPage: true })
      console.log(`Captura verificada: ${categoria}-${formato}`)
      await page.close()
    }
  }
} finally { await browser.close() }
