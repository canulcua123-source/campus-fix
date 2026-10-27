import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { useAuth } from '../auth/store'
import { servidor } from './msw/server'

beforeAll(() => servidor.listen({ onUnhandledRequest: 'error' }))

afterEach(() => {
  cleanup()
  servidor.resetHandlers()
  useAuth.setState({ token: null, usuario: null, aviso: null, restaurando: false })
})

afterAll(() => servidor.close())

if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal() { this.open = true }
  HTMLDialogElement.prototype.close = function close() { this.open = false }
}
