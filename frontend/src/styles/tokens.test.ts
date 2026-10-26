import { describe, expect, it } from 'vitest'
import css from './tokens.css?raw'

/** T-058: comprueba con la fórmula WCAG 2.1 los pares texto/fondo documentados en README (Sistema de diseño). */

function bloque(selector: string): Record<string, string> {
  const inicio = css.indexOf(selector)
  if (inicio < 0) throw new Error(`No existe el bloque ${selector}`)
  const abre = css.indexOf('{', inicio)
  const cierra = css.indexOf('}', abre)
  const tokens: Record<string, string> = {}
  for (const m of css.slice(abre + 1, cierra).matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) tokens[m[1]] = m[2].toLowerCase()
  return tokens
}

function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contraste(a: string, b: string): number {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

const claro = bloque(':root {')
const oscuroForzado = bloque(":root[data-theme='dark'] {")
const oscuroSistema = bloque(":root:not([data-theme='light']) {")
const oscuro = { ...claro, ...oscuroForzado }

const FONDOS = ['--color-bg', '--color-surface', '--color-surface-2']
const TEXTOS = ['--color-text', '--color-text-muted', '--color-primary', '--color-success', '--color-warning', '--color-danger', '--color-info']
const SOLIDOS = ['primary', 'secondary', 'success', 'warning', 'danger', 'info']
const INSIGNIAS = [
  'estado-abierta', 'estado-en-proceso', 'estado-en-espera', 'estado-resuelta', 'estado-cerrada', 'estado-retirada',
  'prioridad-baja', 'prioridad-media', 'prioridad-alta', 'prioridad-critica',
  'categoria-computo-redes', 'categoria-infraestructura', 'categoria-academico', 'ia',
]

function pares(t: Record<string, string>): [string, string, string, number][] {
  const lista: [string, string, string, number][] = []
  for (const texto of TEXTOS) for (const fondo of FONDOS) lista.push([texto, t[texto], t[fondo], 4.5])
  for (const s of SOLIDOS) lista.push([`--color-on-${s}`, t[`--color-on-${s}`], t[`--color-${s}`], 4.5])
  for (const i of INSIGNIAS) lista.push([`--${i}-text`, t[`--${i}-text`], t[`--${i}-bg`], 4.5])
  // No texto (WCAG 1.4.11): anillo de foco y borde de campos ≥ 3:1.
  for (const fondo of FONDOS) lista.push(['--color-focus', t['--color-focus'], t[fondo], 3])
  lista.push(['--color-border-strong', t['--color-border-strong'], t['--color-surface'], 3])
  return lista
}

describe.each([['claro', claro], ['oscuro', oscuro]])('contraste WCAG AA en tema %s', (_tema, tokens) => {
  it.each(pares(tokens))('%s cumple su mínimo', (_nombre, a, b, minimo) => {
    expect(a, 'token sin definir').toMatch(/^#/)
    expect(b, 'token sin definir').toMatch(/^#/)
    expect(contraste(a, b)).toBeGreaterThanOrEqual(minimo)
  })
})

describe('variantes oscuras', () => {
  it('el oscuro por sistema y el forzado definen los mismos valores', () => {
    expect(oscuroSistema).toEqual(oscuroForzado)
  })

  it('todo token de color claro tiene variante oscura', () => {
    const colores = Object.keys(claro)
    expect(colores.filter((k) => !(k in oscuroForzado))).toEqual([])
  })
})
