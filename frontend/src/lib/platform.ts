export type Plataforma = 'ios' | 'android' | 'desktop'

export function detectarPlataforma(): Plataforma {
  const ua = navigator.userAgent
  const esIpadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  if (/iPad|iPhone|iPod/.test(ua) || esIpadOS) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'desktop'
}

export function aplicarPlataforma(): Plataforma {
  const p = detectarPlataforma()
  document.documentElement.dataset.platform = p
  return p
}

export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

export function esSafariIOS(): boolean {
  return detectarPlataforma() === 'ios' && /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent)
}
