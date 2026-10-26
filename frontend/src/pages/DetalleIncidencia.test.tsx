// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { useAuth } from '../auth/store'
import DetalleIncidencia from './DetalleIncidencia'
import { detallePrueba, categoriasPrueba } from '../test/detalle-fixture'

const server = setupServer()
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(() => { cleanup(); server.resetHandlers(); useAuth.getState().cerrarSesion(); vi.useRealTimers() })
afterAll(() => server.close())

function montar() {
  useAuth.setState({ usuario: { nombre: 'Dirección', rol: 'directivo', permisos: ['incidencias:ver'], alcance: 'global' } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/incidencias/abc']}><Routes><Route path="/incidencias/:id" element={<DetalleIncidencia />} /></Routes></MemoryRouter></QueryClientProvider>)
}

for (const [categoria, especifico, texto] of categoriasPrueba) {
  it(`renderiza detalle polimórfico: ${categoria}`, async () => {
    server.use(http.get('*/incidencias/abc', () => HttpResponse.json({ ...detallePrueba, categoria, detalle_especifico: especifico })))
    montar()
    expect(await screen.findByText(texto)).toBeTruthy()
    expect(screen.getByText('Solo lectura')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /asignar|registrar seguimiento/i })).toBeNull()
  })
}

it('ordena la bitácora e identifica al técnico anterior después de una reasignación', async () => {
  server.use(http.get('*/incidencias/abc', () => HttpResponse.json(detallePrueba)))
  montar()
  await screen.findByText('Bitácora')
  const lista = screen.getByRole('list')
  const entradas = within(lista).getAllByRole('listitem')
  expect(entradas[0].textContent).toContain('Ana López')
  expect(entradas[1].textContent).toContain('Pedro Técnico anterior')
  expect(entradas[1].textContent).toContain('1.5 h')
  expect(entradas[2].textContent).toContain('Carla Coordinadora')
})

for (const [status, mensaje] of [[404, 'No encontramos esta incidencia'], [403, 'No tienes acceso a esta incidencia']] as const) {
  it(`muestra ${status} amigable`, async () => {
    server.use(http.get('*/incidencias/abc', () => HttpResponse.json({ detail: 'No disponible' }, { status })))
    montar()
    expect(await screen.findByText(mensaje)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Volver al inicio' })).toBeTruthy()
  })
}

it('pide evidencia bajo demanda, renueva el enlace y abre PDF en otra pestaña', async () => {
  let solicitudes = 0
  server.use(
    http.get('*/incidencias/abc', () => HttpResponse.json({ ...detallePrueba, evidencias_adjuntas: [{ evidencia_id: 'pdf', nombre_archivo: 'Informe.pdf', tipo_mime: 'application/pdf', peso_kb: 12, url_storage: 'evidencias/pdf', fecha_carga: '2026-10-20T10:00:00Z', subido_por: 'u1' }] })),
    http.get('*/incidencias/abc/evidencias/pdf/url', () => HttpResponse.json({ url: `https://archivos.example/informe.pdf?v=${++solicitudes}`, expira_en: 16 })),
  )
  montar()
  await screen.findByRole('button', { name: 'Ver Informe.pdf' })
  expect(solicitudes).toBe(0)
  fireEvent.click(screen.getByRole('button', { name: 'Ver Informe.pdf' }))
  await screen.findByRole('button', { name: 'Abrir PDF en una pestaña' })
  expect(solicitudes).toBe(1)
  await waitFor(() => expect(solicitudes).toBe(2), { timeout: 6500 })
  const abrir = vi.spyOn(window, 'open').mockReturnValue(null)
  fireEvent.click(screen.getByRole('button', { name: 'Abrir PDF en una pestaña' }))
  expect(abrir).toHaveBeenCalledWith('https://archivos.example/informe.pdf?v=2', '_blank', 'noopener,noreferrer')
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
}, 10000)

it('muestra estados de carga y secciones vacías', async () => {
  let resolver!: () => void
  const pendiente = new Promise<void>((resolve) => { resolver = resolve })
  server.use(http.get('*/incidencias/abc', async () => {
    await pendiente
    return HttpResponse.json({ ...detallePrueba, historial_seguimiento: [] })
  }))
  montar()
  expect(screen.getByRole('status', { name: 'Cargando incidencia.' })).toBeTruthy()
  resolver()
  expect(await screen.findByText('Sin movimientos registrados.')).toBeTruthy()
  expect(screen.getByText('Sin evidencias')).toBeTruthy()
})

it('renueva la imagen si el almacenamiento rechaza su enlace', async () => {
  let solicitudes = 0
  server.use(
    http.get('*/incidencias/abc', () => HttpResponse.json({ ...detallePrueba, evidencias_adjuntas: [{ evidencia_id: 'foto', nombre_archivo: 'Foto.jpg', tipo_mime: 'image/jpeg', peso_kb: 24, url_storage: 'evidencias/foto', fecha_carga: '2026-10-20T10:00:00Z', subido_por: 'u1' }] })),
    http.get('*/incidencias/abc/evidencias/foto/url', () => HttpResponse.json({ url: `https://archivos.example/foto.jpg?v=${++solicitudes}`, expira_en: 300 })),
  )
  montar()
  fireEvent.click(await screen.findByRole('button', { name: 'Ver Foto.jpg' }))
  const imagen = await screen.findByRole('img', { name: 'Foto.jpg' })
  fireEvent.error(imagen)
  await waitFor(() => expect(imagen.getAttribute('src')).toBe('https://archivos.example/foto.jpg?v=2'))
})
