// @vitest-environment jsdom
import '../../test/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { BASE } from '../../api/client'
import { useAuth } from '../../auth/store'
import { servidor } from '../../test/msw/server'
import AdminEdificios from '../AdminEdificios'

const CATALOGO = [
  {
    edificio: 'Edificio A', total_aulas: 3, activas: 2, pisos: [0, 2],
    aulas: [
      { id_publico: 'AaaaaaaaaaaaaaaaaaaaA1', piso: 0, aula: 'A-001', activa: true },
      { id_publico: 'AaaaaaaaaaaaaaaaaaaaA2', piso: 2, aula: 'A-201', activa: true },
      { id_publico: 'AaaaaaaaaaaaaaaaaaaaA3', piso: 2, aula: 'A-202', activa: false },
    ],
  },
  {
    edificio: 'Biblioteca', total_aulas: 1, activas: 1, pisos: [1],
    aulas: [{ id_publico: 'BbbbbbbbbbbbbbbbbbbbB1', piso: 1, aula: 'Sala de lectura', activa: true }],
  },
]

function montar(respuesta: () => Response) {
  servidor.use(http.get(`${BASE}/aulas`, respuesta))
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={cliente}><MemoryRouter><AdminEdificios /></MemoryRouter></QueryClientProvider>)
}

describe('AdminEdificios', () => {
  beforeEach(() => {
    useAuth.setState({
      token: 'token-sintetico-edificios',
      usuario: { nombre: 'Admin', rol: 'admin', alcance: 'global', permisos: ['usuarios:gestionar'] },
    })
  })

  it('muestra skeleton, indicadores y una sección por edificio con pisos y tabla de aulas', async () => {
    const u = userEvent.setup()
    montar(() => HttpResponse.json(CATALOGO))
    expect(screen.getByRole('status', { name: 'Cargando edificios' })).toBeInTheDocument()
    const seccion = (await screen.findByRole('heading', { name: 'Edificio A' })).closest('section')!
    const resumen = screen.getByRole('group', { name: 'Resumen del catálogo' })
    expect(resumen).toHaveTextContent('Edificios2')
    expect(resumen).toHaveTextContent('Aulas4')
    expect(resumen).toHaveTextContent('Activas3')
    expect(resumen).toHaveTextContent('Inactivas1')
    expect(within(seccion).getByText(/3 aulas · 2 activas · 1 inactiva · 2 pisos/)).toBeInTheDocument()
    const pisos = within(seccion).getByRole('list', { name: 'Pisos de Edificio A' })
    expect(pisos).toHaveTextContent('Planta baja· 1 aula')
    expect(pisos).toHaveTextContent('Piso 2· 2 aulas')

    await u.click(within(seccion).getByRole('button', { name: 'Ver aulas' }))
    const tabla = within(seccion).getByRole('table', { name: 'Aulas de Edificio A' })
    const fila = within(tabla).getByRole('row', { name: /A-202/ })
    expect(fila).toHaveTextContent('Piso 2')
    expect(fila).toHaveTextContent('Inactiva')
    expect(within(tabla).getByText('AaaaaaaaaaaaaaaaaaaaA1')).toBeInTheDocument()
    await u.click(within(tabla).getByRole('button', { name: 'Copiar QR de A-001' }))
    expect(await navigator.clipboard.readText()).toBe('AaaaaaaaaaaaaaaaaaaaA1')
    expect(within(tabla).getByRole('button', { name: 'QR de A-001 copiado' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Biblioteca' })).toBeInTheDocument()
  })

  it('filtra por edificio, aula o estado y muestra sin resultados', async () => {
    const u = userEvent.setup()
    montar(() => HttpResponse.json(CATALOGO))
    const buscar = await screen.findByRole('searchbox', { name: 'Buscar edificio o aula' })
    await u.type(buscar, 'biblio')
    expect(screen.getByRole('heading', { name: 'Biblioteca' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Edificio A' })).not.toBeInTheDocument()
    await u.clear(buscar)
    await u.type(buscar, 'a-20')
    expect(screen.getByText('2 de 3 aulas coinciden')).toBeInTheDocument()
    expect(screen.getByText('A-201')).toBeInTheDocument()
    expect(screen.queryByText('A-001')).not.toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Inactivas' }))
    expect(screen.getByText('1 de 3 aulas coinciden')).toBeInTheDocument()
    expect(screen.queryByText('A-201')).not.toBeInTheDocument()
    await u.clear(buscar)
    await u.type(buscar, 'zzz')
    expect(screen.getByRole('heading', { name: 'Sin resultados' })).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    expect(screen.getByRole('heading', { name: 'Biblioteca' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Todas' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('muestra estado vacío con acceso a «Nueva aula»', async () => {
    montar(() => HttpResponse.json([]))
    expect(await screen.findByRole('heading', { name: 'Aún no hay aulas registradas' })).toBeInTheDocument()
    expect(screen.getByText(/Usa «Nueva aula» para darlas de alta; cada una recibe su código QR\./)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Nueva aula' })).toHaveLength(2)
  })

  it('crea un aula con el cuerpo correcto, refresca el catálogo y avisa', async () => {
    const u = userEvent.setup()
    let catalogo = CATALOGO
    const cuerpos: unknown[] = []
    servidor.use(http.post(`${BASE}/aulas`, async ({ request }) => {
      const cuerpo = await request.json() as Record<string, unknown>
      cuerpos.push(cuerpo)
      catalogo = [...CATALOGO, {
        edificio: 'Edificio C', total_aulas: 1, activas: 1, pisos: [-1],
        aulas: [{ id_publico: 'CcccccccccccccccccccC1', piso: -1, aula: 'C-S01', activa: true }],
      }]
      return HttpResponse.json({ id_publico: 'CcccccccccccccccccccC1', ...cuerpo }, { status: 201 })
    }))
    montar(() => HttpResponse.json(catalogo))
    await u.click(await screen.findByRole('button', { name: 'Nueva aula' }))
    const hoja = screen.getByRole('dialog', { name: 'Nueva aula' })
    const edificio = within(hoja).getByRole('combobox', { name: /Edificio/ })
    expect(hoja.querySelectorAll('datalist option')).toHaveLength(2)

    await u.click(within(hoja).getByRole('button', { name: 'Crear aula' }))
    expect(await within(hoja).findByText('Escribe el edificio')).toBeInTheDocument()
    expect(within(hoja).getByText('Escribe el nombre del aula')).toBeInTheDocument()
    expect(cuerpos).toHaveLength(0)

    await u.type(edificio, '  Edificio C ')
    const piso = within(hoja).getByRole('spinbutton', { name: /Piso/ })
    await u.clear(piso)
    await u.type(piso, '-1')
    await u.type(within(hoja).getByRole('textbox', { name: /Aula/ }), 'C-S01')
    await u.click(within(hoja).getByRole('button', { name: 'Crear aula' }))

    await waitFor(() => expect(cuerpos).toEqual([{ edificio: 'Edificio C', piso: -1, aula: 'C-S01', activa: true }]))
    expect(await screen.findByText(/Aula C-S01 creada en Edificio C\. Su ID del QR es CcccccccccccccccccccC1/)).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Edificio C' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Nueva aula' })).not.toBeInTheDocument()
  })

  it('muestra el 409 de ubicación duplicada sin cerrar el formulario', async () => {
    const u = userEvent.setup()
    servidor.use(http.post(`${BASE}/aulas`, () =>
      HttpResponse.json({ error: 'conflicto', detalle: 'Ya existe un aula con ese edificio, piso y aula' }, { status: 409 })))
    montar(() => HttpResponse.json(CATALOGO))
    await u.click(await screen.findByRole('button', { name: 'Nueva aula' }))
    const hoja = screen.getByRole('dialog', { name: 'Nueva aula' })
    await u.type(within(hoja).getByRole('combobox', { name: /Edificio/ }), 'Edificio A')
    await u.type(within(hoja).getByRole('textbox', { name: /Aula/ }), 'A-001')
    await u.click(within(hoja).getByRole('button', { name: 'Crear aula' }))
    expect(await within(hoja).findByRole('alert')).toHaveTextContent('Ya existe un aula con ese edificio, piso y aula')
    expect(screen.getByRole('dialog', { name: 'Nueva aula' })).toBeInTheDocument()
  })

  it('edita un aula enviando solo los campos cambiados', async () => {
    const u = userEvent.setup()
    const peticiones: { id: string; cuerpo: unknown }[] = []
    servidor.use(http.patch(`${BASE}/aulas/:id`, async ({ request, params }) => {
      const cuerpo = await request.json() as Record<string, unknown>
      peticiones.push({ id: String(params.id), cuerpo })
      return HttpResponse.json({ id_publico: params.id, edificio: 'Edificio A', piso: 2, aula: 'A-201', activa: true, ...cuerpo })
    }))
    montar(() => HttpResponse.json(CATALOGO))
    const seccion = (await screen.findByRole('heading', { name: 'Edificio A' })).closest('section')!
    await u.click(within(seccion).getByRole('button', { name: 'Ver aulas' }))
    await u.click(within(seccion).getByRole('button', { name: 'Editar A-201' }))
    const hoja = screen.getByRole('dialog', { name: 'Editar aula' })
    const aula = within(hoja).getByRole('textbox', { name: /Aula/ })
    expect(aula).toHaveValue('A-201')
    expect(within(hoja).getByRole('combobox', { name: /Edificio/ })).toHaveValue('Edificio A')
    expect(within(hoja).getByRole('spinbutton', { name: /Piso/ })).toHaveValue(2)
    await u.click(within(hoja).getByRole('button', { name: 'Guardar cambios' }))
    expect(await within(hoja).findByRole('alert')).toHaveTextContent('No hay cambios que guardar')
    await u.clear(aula)
    await u.type(aula, 'A-210')
    await u.click(within(hoja).getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(peticiones).toEqual([{ id: 'AaaaaaaaaaaaaaaaaaaaA2', cuerpo: { aula: 'A-210' } }]))
    expect(await screen.findByText('Aula A-210 actualizada')).toBeInTheDocument()
  })

  it('desactiva con confirmación y activa sin confirmación', async () => {
    const u = userEvent.setup()
    const peticiones: { id: string; cuerpo: unknown }[] = []
    servidor.use(http.patch(`${BASE}/aulas/:id`, async ({ request, params }) => {
      const cuerpo = await request.json() as Record<string, unknown>
      peticiones.push({ id: String(params.id), cuerpo })
      return HttpResponse.json({ id_publico: params.id, edificio: 'Edificio A', piso: 0, aula: 'A-001', activa: true, ...cuerpo })
    }))
    montar(() => HttpResponse.json(CATALOGO))
    const seccion = (await screen.findByRole('heading', { name: 'Edificio A' })).closest('section')!
    await u.click(within(seccion).getByRole('button', { name: 'Ver aulas' }))
    await u.click(within(seccion).getByRole('button', { name: 'Desactivar A-001' }))
    const confirmar = screen.getByRole('dialog', { name: '¿Desactivar aula?' })
    expect(confirmar).toHaveTextContent('su código QR ya no abrirá el formulario')
    expect(peticiones).toHaveLength(0)
    await u.click(within(confirmar).getByRole('button', { name: 'Confirmar desactivación' }))
    await waitFor(() => expect(peticiones).toEqual([{ id: 'AaaaaaaaaaaaaaaaaaaaA1', cuerpo: { activa: false } }]))
    expect(await screen.findByText('Aula A-001 desactivada')).toBeInTheDocument()

    await u.click(within(seccion).getByRole('button', { name: 'Activar A-202' }))
    await waitFor(() => expect(peticiones.at(-1)).toEqual({ id: 'AaaaaaaaaaaaaaaaaaaaA3', cuerpo: { activa: true } }))
    expect(await screen.findByText('Aula A-202 activada')).toBeInTheDocument()
  })

  it('muestra error con reintentar', async () => {
    let llamadas = 0
    montar(() => (++llamadas === 1 ? HttpResponse.json({ detail: 'falla' }, { status: 500 }) : HttpResponse.json(CATALOGO)))
    await userEvent.setup().click(await screen.findByRole('button', { name: /Reintentar/ }))
    expect(await screen.findByRole('heading', { name: 'Edificio A' })).toBeInTheDocument()
  })
})
