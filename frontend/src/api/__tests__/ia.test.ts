// @vitest-environment jsdom
import '../../test/setup'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TIMEOUT_IA_MS, ApiError } from '../client'
import { analizarImagen } from '../ia'
import { respuesta } from './utilidades'

const ANALISIS = {
  es_incidencia_valida: true,
  categoria: 'infraestructura',
  titulo: 'Luminaria fundida',
  descripcion: 'Se observa una luminaria apagada.',
  prioridad_sugerida: 'baja',
  tags: ['luminaria'],
  campos_detectados: [{ nombre: 'tipo', valor: 'luminaria' }],
  confianza: 0.9,
  advertencias: [],
}

function imagen() {
  return new File(['foto'], 'foto.jpg', { type: 'image/jpeg' })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('analizarImagen', () => {
  it('aborta a los 30s', async () => {
    vi.useFakeTimers()
    const señales: AbortSignal[] = []
    vi.stubGlobal('fetch', vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      if (init?.signal) señales.push(init.signal)
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    }))

    const resultado = analizarImagen({ imagen: imagen() }).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(TIMEOUT_IA_MS)
    const error = await resultado

    expect(TIMEOUT_IA_MS).toBe(30_000)
    expect(señales).toHaveLength(1)
    expect(señales[0].aborted).toBe(true)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).codigo).toBe('timeout')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('limpia el temporizador si termina antes', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => respuesta(200, ANALISIS))
    vi.stubGlobal('fetch', fetchMock)

    await analizarImagen({ imagen: imagen() })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('conserva la cancelación externa', async () => {
    vi.useFakeTimers()
    const externo = new AbortController()
    vi.stubGlobal('fetch', vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })))

    const resultado = analizarImagen({ imagen: imagen() }, { signal: externo.signal }).catch((error: unknown) => error)
    externo.abort()
    const error = await resultado

    expect(error).toBeInstanceOf(DOMException)
    expect((error as DOMException).name).toBe('AbortError')
    expect(vi.getTimerCount()).toBe(0)
  })
})
