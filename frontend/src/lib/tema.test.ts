// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { CLAVE_TEMA, aplicarTema, guardarTema, iniciarTema, leerTema, temaEfectivo } from './tema'

const sistema = (oscuro: boolean) => () => ({ matches: oscuro })

function metas() {
  return [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((m) => m.content)
}

describe('tema (T-058)', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
    document.head.innerHTML = `
      <meta name="theme-color" content="CLARO" media="(prefers-color-scheme: light)" />
      <meta name="theme-color" content="OSCURO" media="(prefers-color-scheme: dark)" />`
  })

  it('auto sigue prefers-color-scheme', () => {
    expect(temaEfectivo('auto', sistema(true))).toBe('oscuro')
    expect(temaEfectivo('auto', sistema(false))).toBe('claro')
    expect(temaEfectivo('claro', sistema(true))).toBe('claro')
    aplicarTema('auto')
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(metas()).toEqual(['CLARO', 'OSCURO'])
  })

  it('persiste eleccion', () => {
    expect(leerTema()).toBe('auto')
    guardarTema('oscuro')
    expect(localStorage.getItem(CLAVE_TEMA)).toBe('oscuro')
    delete document.documentElement.dataset.theme
    iniciarTema() // simula recargar la página
    expect(leerTema()).toBe('oscuro')
    expect(document.documentElement.dataset.theme).toBe('dark')
    guardarTema('auto')
    expect(localStorage.getItem(CLAVE_TEMA)).toBeNull()
  })

  it('ajusta theme-color al tema forzado y lo restaura en auto', () => {
    aplicarTema('oscuro')
    expect(metas()).toEqual(['OSCURO', 'OSCURO'])
    aplicarTema('claro')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(metas()).toEqual(['CLARO', 'CLARO'])
    aplicarTema('auto')
    expect(metas()).toEqual(['CLARO', 'OSCURO'])
  })

  it('ignora valores guardados inválidos', () => {
    localStorage.setItem(CLAVE_TEMA, 'morado')
    expect(leerTema()).toBe('auto')
  })
})
