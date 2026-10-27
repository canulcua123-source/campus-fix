import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { useAuth } from '../../auth/store'
import {
  ApiError, ConflictoError, MENSAJE_SESION_EXPIRADA, NoAutenticadoError, SinPermisoError, ValidacionError,
  api, debeReintentar, mapearError,
} from '../client'
import { crearQueryClient } from '../queryClient'
import { respuesta, simularFetch } from './utilidades'

const usuario = { nombre: 'Ana', rol: 'tecnico', permisos: ['incidencias:ver'], alcance: 'area' as const }

async function capturar(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p
  } catch (e) {
    if (e instanceof ApiError) return e
    throw e
  }
  throw new Error('se esperaba un error')
}

beforeEach(() => {
  useAuth.setState({ token: null, usuario: null, aviso: null })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('lee error y detalle', () => {
  it('400 de validación {error, detalle[]} → ValidacionError con campos por ruta (sin body ni etiqueta de unión)', () => {
    const e = mapearError(400, {
      error: 'validacion',
      detalle: [
        { type: 'string_too_short', loc: ['body', 'titulo'], msg: 'String should have at least 5 characters' },
        { type: 'less_than_equal', loc: ['body', 'detalle_especifico', 'computo_redes', 'vlan'], msg: 'Input should be <= 4094' },
        { type: 'greater_than_equal', loc: ['body', 'ubicacion', 'piso'], msg: '...' },
      ],
    })
    expect(e).toBeInstanceOf(ValidacionError)
    expect(e.codigo).toBe('validacion')
    expect(e.campos).toEqual({
      titulo: 'Texto demasiado corto',
      'detalle_especifico.vlan': 'El valor excede el máximo',
      'ubicacion.piso': 'El valor es menor al mínimo',
    })
    expect(e.message).toBe('Revisa los campos marcados')
  })

  it('400 de $jsonSchema sin loc → mensaje general', () => {
    const e = mapearError(400, { error: 'validacion', detalle: [{ msg: 'El documento no cumple el esquema de la base de datos' }] })
    expect(e.campos).toEqual({ _general: 'El documento no cumple el esquema de la base de datos' })
    expect(e.message).toBe('El documento no cumple el esquema de la base de datos')
  })

  it('HTTPException {detail} → usa el texto en español', () => {
    const e = mapearError(409, { detail: 'Transición de estado no permitida' })
    expect(e).toBeInstanceOf(ConflictoError)
    expect(e.message).toBe('Transición de estado no permitida')
  })

  it('409 duplicado {error, detalle: str}', () => {
    const e = mapearError(409, { error: 'duplicado', detalle: 'Registro duplicado' })
    expect(e.codigo).toBe('duplicado')
    expect(e.message).toBe('Registro duplicado')
  })

  it('413/411 del middleware de cuerpo', () => {
    expect(mapearError(413, { error: 'cuerpo_demasiado_grande' }).message).toBe('El archivo o los datos son demasiado grandes')
    expect(mapearError(411, { error: 'longitud_requerida' }).codigo).toBe('longitud_requerida')
  })

  it('mapea 400/401/403/409 a sus clases y mensajes en español', () => {
    expect(mapearError(400, { detail: 'Identificador inválido' })).toBeInstanceOf(ValidacionError)
    const e401 = mapearError(401, { detail: 'Token inválido o expirado' })
    expect(e401).toBeInstanceOf(NoAutenticadoError)
    expect(e401.message).toBe(MENSAJE_SESION_EXPIRADA)
    expect(mapearError(401, { detail: 'Credenciales inválidas' }).message).toBe('Correo o contraseña incorrectos')
    const e403 = mapearError(403, { detail: 'Falta el permiso analitica:ver' })
    expect(e403).toBeInstanceOf(SinPermisoError)
    expect(e403.message).toBe('No tienes permiso para esta acción')
    expect(mapearError(403, { detail: 'Solo un coordinador puede cerrar incidencias' }).message).toBe('Solo un coordinador puede cerrar incidencias')
    expect(mapearError(404, { detail: 'Not Found' }).message).toBe('No encontramos lo que buscas')
    expect(mapearError(503, { detail: 'El análisis con IA está deshabilitado' }).codigo).toBe('no_disponible')
  })
})

describe('429 con retry-after', () => {
  it('slowapi en inglés → mensaje en español con los segundos de Retry-After', async () => {
    simularFetch(() => respuesta(429, { error: 'Rate limit exceeded: 10 per 1 minute' }, { 'Retry-After': '30' }))
    const e = await capturar(api('/incidencias'))
    expect(e.codigo).toBe('limite')
    expect(e.reintentarEn).toBe(30)
    expect(e.message).toBe('Demasiados intentos, espera un momento (intenta de nuevo en 30 s)')
  })

  it('429 con detail en español y sin Retry-After', () => {
    const e = mapearError(429, { detail: 'Alcanzaste el límite de 20 análisis por día' }, new Headers())
    expect(e.message).toBe('Alcanzaste el límite de 20 análisis por día')
    expect(e.reintentarEn).toBeNull()
  })
})

describe('respuesta no json', () => {
  it('502 en HTML de un proxy no rompe: ApiError controlado', async () => {
    simularFetch(() => respuesta(502, '<html><body>Bad Gateway</body></html>'))
    const e = await capturar(api('/incidencias'))
    expect(e.status).toBe(502)
    expect(e.message).toBe('El servicio no está disponible por ahora')
  })

  it('200 con JSON truncado y schema → error de contrato, no excepción de JSON.parse', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    simularFetch(() => new Response('{"ok": tr', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const e = await capturar(api('/x', { schema: z.object({ ok: z.boolean() }) }))
    expect(e.codigo).toBe('contrato')
  })

  it('red caída → codigo red con mensaje en español', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const e = await capturar(api('/incidencias'))
    expect(e.status).toBe(0)
    expect(e.codigo).toBe('red')
    expect(e.message).toMatch(/Sin conexión/)
  })

  it('timeout → codigo timeout', async () => {
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_, rej) => {
      init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
    })))
    const e = await capturar(api('/lento', { timeoutMs: 10 }))
    expect(e.codigo).toBe('timeout')
  })
})

describe('valida respuesta con zod', () => {
  it('respuesta válida se devuelve tipada', async () => {
    simularFetch(() => respuesta(200, { ok: true, extra: 1 }))
    const r = await api('/x', { schema: z.object({ ok: z.literal(true) }) })
    expect(r).toEqual({ ok: true })
  })

  it('respuesta que no cumple el esquema → ApiError contrato', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    simularFetch(() => respuesta(200, { ok: 'si' }))
    const e = await capturar(api('/x', { schema: z.object({ ok: z.boolean() }) }))
    expect(e.codigo).toBe('contrato')
    expect(e.message).toBe('La respuesta del servidor no tiene el formato esperado')
    expect(log).toHaveBeenCalled()
  })
})

describe('cabeceras', () => {
  it('Bearer desde el store; Content-Type solo con json; FormData sin Content-Type', async () => {
    useAuth.setState({ token: 'tkn', usuario })
    const f = simularFetch(() => respuesta(200, {}))
    await api('/a', { method: 'POST', json: { x: 1 } })
    await api('/b', { method: 'POST', body: new FormData() })
    await api('/c', { params: { estado: 'abierta', edificio: undefined, limite: 10 } })
    const h = (i: number) => new Headers(f.mock.calls[i][1]?.headers)
    expect(h(0).get('Authorization')).toBe('Bearer tkn')
    expect(h(0).get('Content-Type')).toBe('application/json')
    expect(h(1).get('Content-Type')).toBeNull()
    expect(String(f.mock.calls[2][0])).toBe('http://localhost:8000/c?estado=abierta&limite=10')
  })
})

describe('401 cierra sesion', () => {
  it('limpia el store, deja aviso y llama al callback de expiración una sola vez', async () => {
    const qc = crearQueryClient()
    const clear = vi.spyOn(qc, 'clear')
    useAuth.setState({ token: 'viejo', usuario })
    simularFetch(() => respuesta(401, { detail: 'Token inválido o expirado' }))
    const [a, b] = await Promise.all([capturar(api('/incidencias')), capturar(api('/auth/me'))])
    expect(a).toBeInstanceOf(NoAutenticadoError)
    expect(b.status).toBe(401)
    expect(useAuth.getState().token).toBeNull()
    expect(useAuth.getState().usuario).toBeNull()
    expect(useAuth.getState().aviso).toBe(MENSAJE_SESION_EXPIRADA)
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('401 de /auth/login no cierra sesión (son credenciales inválidas)', async () => {
    useAuth.setState({ token: 'vigente', usuario })
    simularFetch(() => respuesta(401, { detail: 'Credenciales inválidas' }))
    const e = await capturar(api('/auth/login', { method: 'POST', json: {} }))
    expect(e.message).toBe('Correo o contraseña incorrectos')
    expect(useAuth.getState().token).toBe('vigente')
  })

  it('un 401 tardío de un token anterior no cierra la sesión nueva', async () => {
    let soltar: (r: Response) => void = () => {}
    const f = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((res) => { soltar = res }))
      .mockImplementation(async () => respuesta(200, []))
    vi.stubGlobal('fetch', f)
    useAuth.setState({ token: 'viejo', usuario })
    const p = api('/incidencias')
    useAuth.setState({ token: 'nuevo', usuario })
    soltar(respuesta(401, { detail: 'Token inválido o expirado' }))
    // Se reintenta con el token vigente, sin pedir refresh ni cerrar la sesión nueva.
    await expect(p).resolves.toEqual([])
    expect(useAuth.getState().token).toBe('nuevo')
    expect(f).toHaveBeenCalledTimes(2)
    expect(new Headers(f.mock.calls[1][1].headers).get('Authorization')).toBe('Bearer nuevo')
  })
})

describe('queryclient no reintenta 4xx', () => {
  it('política de reintentos', () => {
    for (const s of [400, 401, 403, 404, 409, 413, 429]) expect(debeReintentar(0, new ApiError(s, 'desconocido', ''))).toBe(false)
    expect(debeReintentar(0, new ApiError(503, 'no_disponible', ''))).toBe(true)
    expect(debeReintentar(1, new ApiError(500, 'servidor', ''))).toBe(true)
    expect(debeReintentar(2, new ApiError(500, 'servidor', ''))).toBe(false)
    expect(debeReintentar(0, new ApiError(0, 'red', ''))).toBe(true)
    expect(debeReintentar(0, new ApiError(0, 'timeout', ''))).toBe(true)
    expect(debeReintentar(0, new ApiError(200, 'contrato', ''))).toBe(false)
  })

  it('defaults del QueryClient: mutaciones sin reintento; queries con la política', () => {
    const qc = crearQueryClient()
    expect(qc.getDefaultOptions().mutations?.retry).toBe(false)
    expect(qc.getDefaultOptions().queries?.retry).toBe(debeReintentar)
  })

  it('una query con 404 se pide 1 vez; con 500 se reintenta hasta 2 veces', async () => {
    const qc = crearQueryClient()
    const f404 = simularFetch(() => respuesta(404, { detail: 'Incidencia no encontrada' }))
    await expect(qc.fetchQuery({ queryKey: ['a'], queryFn: () => api('/a'), retryDelay: 0 })).rejects.toBeInstanceOf(ApiError)
    expect(f404).toHaveBeenCalledTimes(1)
    const f500 = simularFetch(() => respuesta(500, { error: 'interno' }))
    await expect(qc.fetchQuery({ queryKey: ['b'], queryFn: () => api('/b'), retryDelay: 0 })).rejects.toBeInstanceOf(ApiError)
    expect(f500).toHaveBeenCalledTimes(3)
  })
})
