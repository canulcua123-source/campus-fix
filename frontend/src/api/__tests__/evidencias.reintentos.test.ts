import { describe, expect, it } from 'vitest'
import { ApiError } from '../client'
import { subirEvidencia, type ReanudarSubida } from '../evidencias'
import { respuesta, simularFetch } from './utilidades'

const FIRMA = { evidencia_id: 'e1', url_storage: 'evidencias/x.jpg', upload_url: 'https://bucket/put?firma', expira_en: 300 }
const REGISTRADA = { ok: true, evidencia_id: 'e1' }
const archivo = () => new File([new Uint8Array(100)], 'foto.jpg', { type: 'image/jpeg' })
const sinEspera = async () => {}

const firma = () => respuesta(200, FIRMA)
const putOk = () => new Response(null, { status: 200 })
const put = (status: number) => () => new Response(null, { status })
const registro = (status: number) => () => (status === 201 ? respuesta(201, REGISTRADA) : respuesta(status, { error: 'servidor' }))

/** Cuántas llamadas hizo fetch a cada paso: firma, PUT al bucket y registro. */
function pasos(f: ReturnType<typeof simularFetch>) {
  const urls = f.mock.calls.map((c) => String(c[0]))
  return {
    firmas: urls.filter((u) => u.endsWith('/evidencias/firma')).length,
    puts: urls.filter((u) => u.startsWith('https://bucket/')).length,
    registros: urls.filter((u) => u.endsWith('/evidencias')).length,
  }
}

describe('subirEvidencia: reintentos', () => {
  it('reintenta el PUT ante errores transitorios hasta lograrlo', async () => {
    const f = simularFetch(firma, put(500), put(503), putOk, registro(201))
    await expect(subirEvidencia('inc1', { archivo: archivo(), esperar: sinEspera })).resolves.toEqual(REGISTRADA)
    expect(pasos(f)).toEqual({ firmas: 1, puts: 3, registros: 1 })
  })

  it('se rinde tras 3 intentos del PUT', async () => {
    const f = simularFetch(firma, put(500))
    await expect(subirEvidencia('inc1', { archivo: archivo(), esperar: sinEspera })).rejects.toBeInstanceOf(ApiError)
    expect(pasos(f)).toEqual({ firmas: 1, puts: 3, registros: 0 })
  })

  it('no reintenta el PUT ante un 4xx', async () => {
    const f = simularFetch(firma, put(403))
    await expect(subirEvidencia('inc1', { archivo: archivo(), esperar: sinEspera })).rejects.toMatchObject({ status: 403 })
    expect(pasos(f)).toEqual({ firmas: 1, puts: 1, registros: 0 })
  })

  it('reintenta solo el registro, sin volver a subir el archivo', async () => {
    const f = simularFetch(firma, putOk, registro(500), registro(201))
    await expect(subirEvidencia('inc1', { archivo: archivo(), esperar: sinEspera })).resolves.toEqual(REGISTRADA)
    expect(pasos(f)).toEqual({ firmas: 1, puts: 1, registros: 2 })
  })

  it('no reintenta el registro ante un 4xx', async () => {
    const f = simularFetch(firma, putOk, registro(409))
    await expect(subirEvidencia('inc1', { archivo: archivo(), esperar: sinEspera })).rejects.toMatchObject({ status: 409 })
    expect(pasos(f).registros).toBe(1)
  })
})

describe('subirEvidencia: reanudar desde el paso que falló', () => {
  it('si falló el PUT, el siguiente intento reutiliza la firma y solo repite PUT y registro', async () => {
    const reanudar: ReanudarSubida = {}
    const f = simularFetch(firma, put(500), put(500), put(500), putOk, registro(201))

    await expect(subirEvidencia('inc1', { archivo: archivo(), esperar: sinEspera, reanudar })).rejects.toBeInstanceOf(ApiError)
    expect(reanudar).toMatchObject({ firma: { evidenciaId: 'e1' }, subido: false })

    await expect(subirEvidencia('inc1', { archivo: archivo(), esperar: sinEspera, reanudar })).resolves.toEqual(REGISTRADA)
    expect(pasos(f)).toEqual({ firmas: 1, puts: 4, registros: 1 })
  })

  it('si falló el registro, el siguiente intento no vuelve a firmar ni a subir', async () => {
    const reanudar: ReanudarSubida = {}
    const f = simularFetch(firma, putOk, registro(500), registro(500), registro(500), registro(201))

    await expect(subirEvidencia('inc1', { archivo: archivo(), esperar: sinEspera, reanudar })).rejects.toBeInstanceOf(ApiError)
    expect(reanudar.subido).toBe(true)

    await expect(subirEvidencia('inc1', { archivo: archivo(), esperar: sinEspera, reanudar })).resolves.toEqual(REGISTRADA)
    expect(pasos(f)).toEqual({ firmas: 1, puts: 1, registros: 4 })
  })

  it('si el bucket rechaza la firma (403), el siguiente intento firma de nuevo', async () => {
    const reanudar: ReanudarSubida = {}
    const f = simularFetch(firma, put(403), firma, putOk, registro(201))

    await expect(subirEvidencia('inc1', { archivo: archivo(), esperar: sinEspera, reanudar })).rejects.toMatchObject({ status: 403 })
    expect(reanudar.firma).toBeUndefined()

    await expect(subirEvidencia('inc1', { archivo: archivo(), esperar: sinEspera, reanudar })).resolves.toEqual(REGISTRADA)
    expect(pasos(f)).toEqual({ firmas: 2, puts: 2, registros: 1 })
  })
})
