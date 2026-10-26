// @vitest-environment jsdom
import '../../test/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { BASE } from '../../api/client'
import { RequirePermiso } from '../../auth/RequirePermiso'
import { useAuth } from '../../auth/store'
import { servidor } from '../../test/msw/server'
import Login from '../Login'
import Reportar from '../Reportar'

const ID_VALIDO = 'AbCdEfGhIjKlMnOpQrStUv'
const URL_AULA = `${BASE}/aulas/${ID_VALIDO}`

function renderReportar(ruta = '/reportar') {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route path="/reportar" element={<Reportar />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function abrirFormulario() {
  await userEvent.click(screen.getByRole('button', { name: 'Llenar sin foto' }))
}

function camposUbicacion() {
  return {
    edificio: screen.getByLabelText('Edificio'),
    piso: screen.getByLabelText('Piso (opcional)'),
    aula: screen.getByLabelText('Aula'),
  }
}

describe('Reportar desde QR T-012', () => {
  it('resuelve un identificador válido y fija la ubicación', async () => {
    servidor.use(http.get(URL_AULA, () => HttpResponse.json({
      id_publico: ID_VALIDO,
      ubicacion: { edificio: 'Edificio A', piso: 2, aula: 'A-201' },
    })))
    renderReportar(`/reportar?aula=${ID_VALIDO}`)
    await abrirFormulario()

    expect(await screen.findByText(/Ubicación fijada por el código QR/)).toBeInTheDocument()
    const campos = camposUbicacion()
    expect(campos.edificio).toHaveValue('Edificio A')
    expect(campos.piso).toHaveValue(2)
    expect(campos.aula).toHaveValue('A-201')
    expect(campos.edificio).toHaveAttribute('readonly')
    expect(campos.piso).toHaveAttribute('readonly')
    expect(campos.aula).toHaveAttribute('readonly')
  })

  it('permite capturar manualmente cuando el identificador no existe', async () => {
    servidor.use(http.get(URL_AULA, () => HttpResponse.json({ detail: 'No encontrado' }, { status: 404 })))
    renderReportar(`/reportar?aula=${ID_VALIDO}`)
    await abrirFormulario()

    expect(await screen.findByRole('alert')).toHaveTextContent('seleccionar la ubicación manualmente')
    const campos = camposUbicacion()
    expect(campos.edificio).not.toHaveAttribute('readonly')
    expect(campos.piso).not.toHaveAttribute('readonly')
    expect(campos.aula).not.toHaveAttribute('readonly')
    await userEvent.type(campos.edificio, 'B')
    expect(campos.edificio).toHaveValue('B')
  })

  it('mantiene el flujo manual cuando no hay parámetro aula', async () => {
    let consultas = 0
    servidor.use(http.get(`${BASE}/aulas/:id`, () => {
      consultas += 1
      return HttpResponse.json({}, { status: 500 })
    }))
    renderReportar()
    await abrirFormulario()

    expect(consultas).toBe(0)
    expect(camposUbicacion().edificio).not.toHaveAttribute('readonly')
  })

  it.each([
    ['un error temporal', HttpResponse.json({ error: 'no_disponible' }, { status: 503 })],
    ['una respuesta fuera del contrato', HttpResponse.json({ id_publico: ID_VALIDO, ubicacion: { edificio: 7 } })],
  ])('deja disponible la ubicación manual ante %s', async (_caso, respuesta) => {
    servidor.use(http.get(URL_AULA, () => respuesta))
    renderReportar(`/reportar?aula=${ID_VALIDO}`)
    await abrirFormulario()

    expect(await screen.findByRole('alert')).toHaveTextContent('seleccionar la ubicación manualmente')
    expect(camposUbicacion().aula).not.toHaveAttribute('readonly')
  })
})

function Destino() {
  const location = useLocation()
  return <p>Destino conservado: {location.pathname}{location.search}</p>
}

describe('Sesión y ruta QR T-012', () => {
  it('conserva /reportar?aula= después de iniciar sesión', async () => {
    servidor.use(http.post(`${BASE}/auth/login`, () => HttpResponse.json({
      access_token: 'token-prueba',
      usuario: { nombre: 'Reportante', rol: 'reportante', alcance: 'propio', permisos: ['incidencias:crear'] },
    })))
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter initialEntries={[`/reportar?aula=${ID_VALIDO}`]}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/reportar" element={
              <RequirePermiso permiso="incidencias:crear"><Destino /></RequirePermiso>
            } />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await screen.findByRole('heading', { name: 'Bienvenido' })
    const usuario = userEvent.setup()
    await usuario.type(screen.getByLabelText(/Correo institucional/), 'persona@example.test')
    await usuario.type(screen.getByLabelText(/Contraseña/), 'clave-segura')
    await usuario.click(screen.getByRole('button', { name: 'Entrar' }))

    expect(await screen.findByText(`Destino conservado: /reportar?aula=${ID_VALIDO}`)).toBeInTheDocument()
    await waitFor(() => expect(useAuth.getState().token).toBe('token-prueba'))
  })
})
