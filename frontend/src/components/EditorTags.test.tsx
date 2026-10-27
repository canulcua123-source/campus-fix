// @vitest-environment jsdom
import '../test/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { BASE } from '../api/client'
import { useAuth } from '../auth/store'
import { detallePrueba } from '../test/detalle-fixture'
import { servidor } from '../test/msw/server'
import DetalleIncidencia from '../pages/DetalleIncidencia'

const ID = detallePrueba._id
const RUTA = `${BASE}/incidencias/${ID}`

function iniciar({ tags = [], permisos = ['incidencias:ver', 'tags:gestionar'] }: {
    tags?: string[]; permisos?: string[]
} = {}) {
    useAuth.setState({
        token: 'token-sintetico-t053',
        usuario: { nombre: 'Técnico de prueba', rol: 'tecnico', alcance: 'area', permisos },
    })
    let actuales = tags.slice()
    const enviados: { metodo: 'POST' | 'DELETE'; tags: string[] }[] = []
    let sugerenciasSolicitadas = 0

    servidor.use(
        http.get(RUTA, () => HttpResponse.json({ ...detallePrueba, tags: actuales })),
        http.post(`${RUTA}/tags`, async ({ request }) => {
            const datos = await request.json() as { tags: string[] }
            enviados.push({ metodo: 'POST', tags: datos.tags })
            actuales = [...new Set([...actuales, ...datos.tags])]
            return HttpResponse.json({ ok: true })
        }),
        http.delete(`${RUTA}/tags`, async ({ request }) => {
            const datos = await request.json() as { tags: string[] }
            enviados.push({ metodo: 'DELETE', tags: datos.tags })
            actuales = actuales.filter((t) => !datos.tags.includes(t))
            return HttpResponse.json({ ok: true })
        }),
        http.get(`${BASE}/analitica/tags`, () => {
            sugerenciasSolicitadas += 1
            return HttpResponse.json([
                { tag: 'cableado_danado', total: 5 },
                { tag: 'wifi', total: 3 },
            ])
        }),
    )

    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(
        <QueryClientProvider client={cliente}>
            <MemoryRouter initialEntries={[`/incidencias/${ID}`]}>
                <Routes><Route path="/incidencias/:id" element={<DetalleIncidencia />} /></Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    )
    return { enviados, getSolicitudesSugerencias: () => sugerenciasSolicitadas }
}

describe('EditorTags (T-053)', () => {
    it('agrega y quita etiquetas y refleja los cambios del servidor', async () => {
        const usuario = userEvent.setup()
        const { enviados } = iniciar({ tags: ['wifi'] })
        const campo = await screen.findByRole('textbox', { name: 'Nueva etiqueta' })
        await usuario.type(campo, 'Cableado Dañado{Enter}')
        expect(await screen.findByText('#cableado_danado')).toBeInTheDocument()
        expect(enviados[0]).toEqual({ metodo: 'POST', tags: ['cableado_danado'] })

        await usuario.click(screen.getByRole('button', { name: 'Quitar etiqueta cableado_danado' }))
        await waitFor(() => expect(screen.queryByText('#cableado_danado')).not.toBeInTheDocument())
        expect(enviados[1]).toEqual({ metodo: 'DELETE', tags: ['cableado_danado'] })
    })

    it('no duplica etiquetas existentes', async () => {
        const usuario = userEvent.setup()
        const { enviados } = iniciar({ tags: ['wifi'] })
        await usuario.type(await screen.findByRole('textbox', { name: 'Nueva etiqueta' }), 'WiFi{Enter}')
        expect(await screen.findByText('La etiqueta ya está registrada en esta incidencia.')).toBeInTheDocument()
        expect(enviados).toHaveLength(0)
        expect(screen.getAllByText('#wifi')).toHaveLength(1)
    })

    it('Retroceso quita la última etiqueta si el campo está vacío', async () => {
        const usuario = userEvent.setup()
        const { enviados } = iniciar({ tags: ['wifi', 'red'] })
        const campo = await screen.findByRole('textbox', { name: 'Nueva etiqueta' })
        await usuario.click(campo)
        await usuario.keyboard('{Backspace}')
        await waitFor(() => expect(screen.queryByText('#red')).not.toBeInTheDocument())
        expect(enviados).toEqual([{ metodo: 'DELETE', tags: ['red'] }])
    })

    it('permite edición manual a técnicos sin pedir analítica (evita 403 de sugerencias)', async () => {
        const usuario = userEvent.setup()
        const estado = iniciar()
        await usuario.type(await screen.findByRole('textbox', { name: 'Nueva etiqueta' }), 'red_wifi{Enter}')
        expect(await screen.findByText('#red_wifi')).toBeInTheDocument()
        expect(estado.getSolicitudesSugerencias()).toBe(0)
    })

    it('muestra autocompletado con datos reales cuando el usuario posee analitica:ver', async () => {
        const usuario = userEvent.setup()
        const { enviados, getSolicitudesSugerencias } = iniciar({
            permisos: ['incidencias:ver', 'tags:gestionar', 'analitica:ver'],
            tags: ['wifi'],
        })
        const sugerencia = await screen.findByRole('button', { name: 'Agregar sugerencia cableado_danado' })
        await usuario.click(sugerencia)
        expect(await screen.findByText('#cableado_danado')).toBeInTheDocument()
        expect(enviados).toEqual([{ metodo: 'POST', tags: ['cableado_danado'] }])
        expect(getSolicitudesSugerencias()).toBeGreaterThan(0)
        expect(screen.queryByRole('button', { name: 'Agregar sugerencia wifi' })).not.toBeInTheDocument()
    })

    it('autocompleta en el campo con las sugerencias filtradas por lo escrito', async () => {
        const usuario = userEvent.setup()
        iniciar({ permisos: ['incidencias:ver', 'tags:gestionar', 'analitica:ver'] })
        await screen.findByRole('button', { name: 'Agregar sugerencia wifi' })
        const campo = screen.getByRole('combobox', { name: 'Nueva etiqueta' })
        await usuario.type(campo, 'Cable')
        const lista = document.getElementById(campo.getAttribute('list') ?? '')
        expect([...(lista?.querySelectorAll('option') ?? [])].map((o) => o.value)).toEqual(['cableado_danado'])
        expect(screen.getByText(/Vista previa: cable\./)).toBeInTheDocument()
    })

    it('oculta el editor si no tiene tags:gestionar', async () => {
        const estado = iniciar({ permisos: ['incidencias:ver'], tags: ['wifi'] })
        expect(await screen.findByText('#wifi')).toBeInTheDocument()
        expect(screen.queryByRole('textbox', { name: 'Nueva etiqueta' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Quitar etiqueta wifi' })).not.toBeInTheDocument()
        expect(estado.getSolicitudesSugerencias()).toBe(0)
    })

    it('no supera el límite de 15 etiquetas', async () => {
        iniciar({ tags: Array.from({ length: 15 }, (_, i) => `tag_${i + 10}`) })
        const campo = await screen.findByRole('textbox', { name: 'Nueva etiqueta' })
        expect(campo).toBeDisabled()
        expect(await screen.findByText(/máximo de 15 etiquetas/i)).toBeInTheDocument()
    })

    it('muestra errores de API y conserva la etiqueta visible si falla DELETE', async () => {
        const usuario = userEvent.setup()
        iniciar({ tags: ['wifi'] })
        servidor.use(http.delete(`${RUTA}/tags`, () => HttpResponse.json({ error: 'sin_permiso' }, { status: 403 })))
        await usuario.click(await screen.findByRole('button', { name: 'Quitar etiqueta wifi' }))
        expect(await screen.findByText('No tienes permiso para modificar las etiquetas.')).toBeInTheDocument()
        expect(screen.getByText('#wifi')).toBeInTheDocument()
    })
})