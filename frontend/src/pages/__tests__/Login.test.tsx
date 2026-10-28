// @vitest-environment jsdom
import '../../test/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BASE } from '../../api/client'
import { useAuth } from '../../auth/store'
import { DOMINIO_CORREO } from '../../schemas/usuario'
import { servidor } from '../../test/msw/server'
import Login, { MS_SERVIDOR_LENTO } from '../Login'

function montar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<p>Pantalla de inicio</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const campoPassword = () => screen.getByLabelText(/^Contraseña/, { selector: 'input' })
const usuarioOk = { nombre: 'Ana', rol: 'reportante', permisos: ['incidencias:crear'], alcance: 'propio' }

afterEach(() => vi.useRealTimers())

describe('Login', () => {
  it('muestra la marca, título inclusivo y atributos de teclado', () => {
    montar()
    expect(screen.getAllByText('UTM Desk').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Campus Fix').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { level: 1, name: 'Inicia sesión' })).toBeInTheDocument()
    const correo = screen.getByLabelText(/Correo institucional/)
    expect(correo).toHaveAttribute('autocomplete', 'username')
    expect(correo).toHaveAttribute('inputmode', 'email')
    expect(correo).toHaveAttribute('autocapitalize', 'none')
    expect(correo).toHaveAttribute('spellcheck', 'false')
    expect(correo).toHaveAttribute('enterkeyhint', 'next')
    expect(screen.getByText(new RegExp(`@${DOMINIO_CORREO.replace(/\./g, '\\.')}`))).toBeInTheDocument()
    expect(campoPassword()).toHaveAttribute('autocomplete', 'current-password')
    expect(campoPassword()).toHaveAttribute('enterkeyhint', 'go')
  })

  it('el ojo dentro del campo alterna la visibilidad de la contraseña', async () => {
    const u = userEvent.setup()
    montar()
    const ojo = screen.getByRole('button', { name: 'Mostrar contraseña' })
    expect(ojo).toHaveAttribute('aria-pressed', 'false')
    expect(campoPassword()).toHaveAttribute('type', 'password')
    await u.click(ojo)
    expect(campoPassword()).toHaveAttribute('type', 'text')
    const ocultar = screen.getByRole('button', { name: 'Ocultar contraseña' })
    expect(ocultar).toHaveAttribute('aria-pressed', 'true')
    await u.click(ocultar)
    expect(campoPassword()).toHaveAttribute('type', 'password')
  })

  it('avisa si Bloq Mayús está activado en la contraseña', () => {
    montar()
    fireEvent.keyDown(campoPassword(), { key: 'A', modifierCapsLock: true })
    expect(screen.getByText('Bloq Mayús está activado.')).toBeInTheDocument()
    fireEvent.keyUp(campoPassword(), { key: 'CapsLock', modifierCapsLock: false })
    expect(screen.queryByText('Bloq Mayús está activado.')).not.toBeInTheDocument()
  })

  it('muestra el aviso de la sesión como informativo, no como error', () => {
    useAuth.setState({ aviso: 'Tu sesión expiró. Vuelve a iniciar sesión.' })
    montar()
    const aviso = screen.getByText('Tu sesión expiró. Vuelve a iniciar sesión.')
    expect(aviso.closest('[role="status"]')).not.toBeNull()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('completa el dominio cuando solo se escribe el usuario', async () => {
    let enviado: unknown
    servidor.use(http.post(`${BASE}/auth/login`, async ({ request }) => {
      enviado = await request.json()
      return HttpResponse.json({ access_token: 't', token_type: 'bearer', usuario: usuarioOk })
    }))
    const u = userEvent.setup()
    montar()
    await u.type(screen.getByLabelText(/Correo institucional/), 'ana.lopez')
    await u.type(campoPassword(), 'secreta{Enter}')
    expect(await screen.findByText('Pantalla de inicio')).toBeInTheDocument()
    expect(enviado).toEqual({ correo: `ana.lopez@${DOMINIO_CORREO}`, password: 'secreta' })
  })

  it('error de validación va bajo el campo y recibe el foco', async () => {
    const u = userEvent.setup()
    montar()
    await u.type(screen.getByLabelText(/Correo institucional/), 'ana@gmail.com')
    await u.click(screen.getByRole('button', { name: /Entrar/ }))
    const correo = screen.getByLabelText(/Correo institucional/)
    expect(await screen.findByText(`Usa tu correo @${DOMINIO_CORREO}`)).toBeInTheDocument()
    expect(correo).toHaveAttribute('aria-invalid', 'true')
    expect(correo).toHaveFocus()
  })

  it('credenciales incorrectas se muestran con role="alert"', async () => {
    servidor.use(http.post(`${BASE}/auth/login`, () => HttpResponse.json({ detail: 'Credenciales inválidas' }, { status: 401 })))
    const u = userEvent.setup()
    montar()
    await u.type(screen.getByLabelText(/Correo institucional/), `ana@${DOMINIO_CORREO}`)
    await u.type(campoPassword(), 'mala{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos')
  })

  it('si el servidor tarda más de 5 s explica el arranque en frío', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    servidor.use(http.post(`${BASE}/auth/login`, () => new Promise<Response>(() => {})))
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    montar()
    await u.type(screen.getByLabelText(/Correo institucional/), `ana@${DOMINIO_CORREO}`)
    await u.type(campoPassword(), 'secreta{Enter}')
    expect(await screen.findByRole('button', { name: /Entrando…/ })).toBeDisabled()
    expect(screen.queryByText(/Despertando el servidor/)).not.toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(MS_SERVIDOR_LENTO) })
    expect(screen.getByText('Despertando el servidor, puede tardar hasta un minuto…')).toBeInTheDocument()
  })
})
