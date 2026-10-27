// @vitest-environment jsdom
import '../test/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { BASE } from '../api/client'
import { servidor } from '../test/msw/server'
import { nombreSeguro } from '../lib/archivos'
import { SubirEvidencia } from './SubirEvidencia'

const procesada = new Blob([new Uint8Array(2048)], { type: 'image/jpeg' })
vi.mock('../lib/fotoEnSegundoPlano', () => ({
  procesarFotoEnSegundoPlano: vi.fn(async () => ({ evidencia: procesada, ia: procesada, miniatura: procesada, ancho: 1, alto: 1 })),
}))

const ID = 'inc1'
const RUTA = `${BASE}/incidencias/${ID}/evidencias`
const BUCKET = 'https://bucket.example.test/put'

interface Contadores { firmas: unknown[]; puts: number; registros: number }

/** Firma → PUT → registro; `put` decide la respuesta del bucket según el número de intento. */
function servidorEvidencias(put: (intento: number) => Response | Promise<Response> = () => new HttpResponse(null, { status: 200 })) {
  const c: Contadores = { firmas: [], puts: 0, registros: 0 }
  servidor.use(
    http.post(`${RUTA}/firma`, async ({ request }) => {
      c.firmas.push(await request.json())
      const n = c.firmas.length
      return HttpResponse.json({ evidencia_id: `e${n}`, url_storage: `evidencias/x/e${n}.pdf`, upload_url: `${BUCKET}?f=${n}`, expira_en: 300 })
    }),
    http.put(BUCKET, () => {
      c.puts += 1
      return put(c.puts)
    }),
    http.post(RUTA, () => {
      c.registros += 1
      return HttpResponse.json({ ok: true, evidencia_id: 'e1' }, { status: 201 })
    }),
  )
  return c
}

function renderSubir(cantidad = 0, hayVideo = false) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={cliente}><SubirEvidencia incidenciaId={ID} cantidad={cantidad} hayVideo={hayVideo} /></QueryClientProvider>)
}

/** Archivo falso de `bytes` sin reservar memoria (jsdom usa `size`). */
function archivoDe(nombre: string, tipo: string, bytes: number) {
  const f = new File([new Uint8Array(16)], nombre, { type: tipo })
  Object.defineProperty(f, 'size', { value: bytes })
  return f
}

const pdf = () => new File([new Uint8Array(1500)], 'informe.pdf', { type: 'application/pdf' })
const entrada = () => screen.getByLabelText('Archivo de evidencia')

describe('SubirEvidencia (T-048)', () => {
  it('sube pdf', async () => {
    const c = servidorEvidencias()
    renderSubir(3)

    await userEvent.upload(entrada(), pdf())

    expect(await screen.findByText('Se adjuntó informe.pdf.')).toBeInTheDocument()
    expect(c.firmas).toEqual([{ nombre_archivo: 'informe.pdf', tipo_mime: 'application/pdf', peso_bytes: 1500 }])
    expect(c).toMatchObject({ puts: 1, registros: 1 })
    expect(screen.getByText(/3 de 10/)).toBeInTheDocument()
  })

  it('procesa las fotos a JPEG sin EXIF antes de firmar', async () => {
    const c = servidorEvidencias()
    renderSubir()

    await userEvent.upload(entrada(), new File(['png'], 'Pizarrón dañado.png', { type: 'image/png' }))

    expect(await screen.findByText('Se adjuntó Pizarrón dañado.jpg.')).toBeInTheDocument()
    expect(c.firmas).toEqual([{ nombre_archivo: 'Pizarrón dañado.jpg', tipo_mime: 'image/jpeg', peso_bytes: procesada.size }])
  })

  it('rechaza tipo invalido antes de pedir la firma', async () => {
    const c = servidorEvidencias()
    renderSubir()

    await userEvent.setup({ applyAccept: false }).upload(entrada(), new File(['x'], 'notas.txt', { type: 'text/plain' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Formato no permitido')
    expect(c.firmas).toHaveLength(0)
  })

  it('rechaza un PDF de más de 10 MB antes de pedir la firma', async () => {
    const c = servidorEvidencias()
    renderSubir()

    await userEvent.upload(entrada(), new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'grande.pdf', { type: 'application/pdf' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('El archivo excede 10 MB')
    expect(c.firmas).toHaveLength(0)
  })

  it('limite 10', async () => {
    const c = servidorEvidencias()
    renderSubir(10)

    expect(screen.getByRole('button', { name: 'Adjuntar evidencia' })).toBeDisabled()
    expect(screen.getByText('Límite de 10 evidencias alcanzado')).toBeInTheDocument()
    await userEvent.upload(entrada(), pdf())

    expect(await screen.findByRole('alert')).toHaveTextContent('límite de 10 evidencias')
    expect(c.firmas).toHaveLength(0)
  })

  it('renueva firma expirada', async () => {
    const c = servidorEvidencias((intento) => new HttpResponse(null, { status: intento === 1 ? 403 : 200 }))
    renderSubir()

    await userEvent.upload(entrada(), pdf())

    expect(await screen.findByText('Se adjuntó informe.pdf.')).toBeInTheDocument()
    expect(c.firmas).toHaveLength(2)
    expect(c).toMatchObject({ puts: 2, registros: 1 })
  })

  it('muestra el progreso y permite cancelar la subida', async () => {
    const c = servidorEvidencias(async () => {
      await delay('infinite')
      return new HttpResponse(null, { status: 200 })
    })
    renderSubir()

    await userEvent.upload(entrada(), pdf())
    expect(await screen.findByRole('progressbar', { name: 'Progreso de la subida' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Subida cancelada')
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
    expect(c.registros).toBe(0)
  })

  it('arma nombres válidos para la firma', () => {
    expect(nombreSeguro('../foto/rara.HEIC', 'jpg')).toBe('._foto_rara.jpg')
    expect(nombreSeguro(`${'a'.repeat(200)}.pdf`)).toHaveLength(120)
  })

  it('sube un video tal cual (sin procesarlo) hasta 50 MB', async () => {
    const c = servidorEvidencias()
    renderSubir(1)
    await userEvent.upload(entrada(), archivoDe('falla.mp4', 'video/mp4', 40 * 1024 * 1024))
    expect(await screen.findByText('Se adjuntó falla.mp4.')).toBeInTheDocument()
    expect(c.firmas).toEqual([{ nombre_archivo: 'falla.mp4', tipo_mime: 'video/mp4', peso_bytes: 40 * 1024 * 1024 }])
  })

  it('rechaza un segundo video, uno de más de 50 MB y fotos de más de 10 MB sin pedir firma', async () => {
    const c = servidorEvidencias()
    const { unmount } = renderSubir(1, true)
    expect(screen.getByText(/ya tiene su video/)).toBeInTheDocument()
    await userEvent.upload(entrada(), archivoDe('otro.mov', 'video/quicktime', 1000))
    expect(await screen.findByText('Esta incidencia ya tiene un video. Solo se permite uno.')).toBeInTheDocument()
    unmount()

    renderSubir(1)
    await userEvent.upload(entrada(), archivoDe('largo.webm', 'video/webm', 50 * 1024 * 1024 + 1))
    expect(await screen.findByText('El video excede 50 MB')).toBeInTheDocument()
    await userEvent.upload(entrada(), archivoDe('scan.pdf', 'application/pdf', 10 * 1024 * 1024 + 1))
    expect(await screen.findByText('El archivo excede 10 MB')).toBeInTheDocument()
    expect(c.firmas).toEqual([])
  })
})
