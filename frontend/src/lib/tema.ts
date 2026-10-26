import { useState } from 'react'

/**
 * Tema de la PWA (RF-GEN-05, T-058): claro, oscuro o automático (sigue `prefers-color-scheme`).
 * La preferencia es visual (no es dato de sesión) y se guarda en localStorage. El script en línea de
 * `index.html` aplica lo mismo antes del primer pintado para que no parpadee al recargar: si cambias la
 * clave o los valores, cámbialos también allá.
 */
export type Tema = 'claro' | 'oscuro' | 'auto'

export const CLAVE_TEMA = 'utm-desk:tema'
export const TEMAS: readonly Tema[] = ['claro', 'oscuro', 'auto']

const CONSULTA_OSCURO = '(prefers-color-scheme: dark)'

/** Lee la preferencia guardada; sin almacenamiento disponible (modo privado) vuelve a 'auto'. */
export function leerTema(): Tema {
  try {
    const valor = localStorage.getItem(CLAVE_TEMA)
    return valor === 'claro' || valor === 'oscuro' ? valor : 'auto'
  } catch {
    return 'auto' // almacenamiento bloqueado: se usa el tema del sistema
  }
}

/** Tema que realmente se ve: 'auto' se resuelve con la preferencia del sistema. */
export function temaEfectivo(tema: Tema, consulta: (q: string) => { matches: boolean } = matchMedia): 'claro' | 'oscuro' {
  if (tema !== 'auto') return tema
  return consulta(CONSULTA_OSCURO).matches ? 'oscuro' : 'claro'
}

/**
 * Pone `data-theme` en <html> y ajusta `<meta name="theme-color">`: en 'auto' cada meta conserva su color
 * original (con su `media`); forzado, todas toman el color del tema elegido (el de la meta `dark` o `light`).
 */
export function aplicarTema(tema: Tema, doc: Document = document): void {
  const raiz = doc.documentElement
  if (tema === 'auto') delete raiz.dataset.theme
  else raiz.dataset.theme = tema === 'oscuro' ? 'dark' : 'light'

  const metas = [...doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')]
  for (const meta of metas) meta.dataset.original ??= meta.content
  const buscada = tema === 'oscuro' ? 'dark' : 'light'
  const forzado = metas.find((m) => (m.getAttribute('media') ?? '').includes(buscada))?.dataset.original
  for (const meta of metas) meta.content = tema === 'auto' || !forzado ? meta.dataset.original! : forzado
}

/** Guarda y aplica la preferencia. */
export function guardarTema(tema: Tema): void {
  try {
    if (tema === 'auto') localStorage.removeItem(CLAVE_TEMA)
    else localStorage.setItem(CLAVE_TEMA, tema)
  } catch {
    // Sin almacenamiento (modo privado): el tema se aplica solo en esta visita.
  }
  aplicarTema(tema)
}

/** Aplica al arrancar la preferencia guardada (main.tsx). */
export function iniciarTema(): void {
  aplicarTema(leerTema())
}

/** Estado React del selector de tema. */
export function useTema(): [Tema, (tema: Tema) => void] {
  const [tema, setTema] = useState<Tema>(leerTema)
  return [tema, (nuevo) => { guardarTema(nuevo); setTema(nuevo) }]
}
