// @vitest-environment jsdom
import '../../test/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { BASE } from '../../api/client'
import { analiticaEdificiosQuery, analiticaResumenQuery, analiticaTagsQuery } from '../../api/analitica'
import { useAuth } from '../../auth/store'
import { servidor } from '../../test/msw/server'
import Dashboard from '../Dashboard'

const RESUMEN = { abiertas: 11, en_proceso: 4, criticas: 2, resueltas_periodo: 6 }
const EDIFICIOS = [
    { edificio: 'A', total: 3, horas_invertidas: 14.5, horas_resolucion_prom: 8.2 },
    { edificio: 'B', total: 2, horas_invertidas: 9, horas_resolucion_prom: null },
]
const TAGS = [{ tag: 'wifi', total: 7 }, { tag: 'filtracion', total: 3 }]
const rutas = {
    resumen: `${BASE}/analitica/resumen`,
    edificios: `${BASE}/analitica/edificios`,
    tags: `${BASE}/analitica/tags`,
}

function preparar(
    mocks: { resumen?: typeof RESUMEN; edificios?: typeof EDIFICIOS; tags?: typeof TAGS } = {},
    seccionConError?: keyof typeof rutas,
) {
    const peticiones: { ruta: string; filtros: URLSearchParams }[] = []
    for (const [tipo, url] of Object.entries(rutas)) {
        servidor.use(http.get(url, ({ request }) => {
            peticiones.push({ ruta: tipo, filtros: new URL(request.url).searchParams })
            if (tipo === seccionConError) return HttpResponse.json({ error: 'no_disponible' }, { status: 503 })
            const respuesta = tipo === 'resumen' ? (mocks.resumen ?? RESUMEN)
                : tipo === 'edificios' ? (mocks.edificios ?? EDIFICIOS) : (mocks.tags ?? TAGS)
            return HttpResponse.json(respuesta)
        }))
    }
    useAuth.setState({
        token: 'token-falso',
        usuario: { nombre: 'Coordinadora', rol: 'coordinador', alcance: 'area', permisos: ['analitica:ver'] },
    })
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const pantalla = render(
        <QueryClientProvider client={cliente}>
            <MemoryRouter><Dashboard /></MemoryRouter>
        </QueryClientProvider>,
    )
    return { ...pantalla, peticiones, cliente }
}

describe('Dashboard T-056 (Vitest + MSW)', () => {
    it('renderiza kpis, barras reales y tablas accesibles', async () => {
        const { peticiones } = preparar()
        expect(await screen.findByLabelText('Abiertas: 11')).toBeInTheDocument()
        expect(screen.getByLabelText('En proceso: 4')).toBeInTheDocument()
        expect(screen.getByLabelText('Críticas: 2')).toBeInTheDocument()
        expect(screen.getByLabelText('Resueltas: 6')).toBeInTheDocument()
        expect(await screen.findByText('Ver tabla de horas por edificio')).toBeInTheDocument()
        expect(await screen.findByText('Ver tabla de etiquetas')).toBeInTheDocument()
        expect(screen.getByText('Los resultados se limitan a tu área asignada.')).toBeInTheDocument()
        fireEvent.click(screen.getByText('Ver tabla de horas por edificio'))
        const tablaEdificios = screen.getByRole('table', { name: /Totales y promedios/i })
        expect(within(tablaEdificios).getByRole('rowheader', { name: 'A' })).toBeInTheDocument()
        expect(within(tablaEdificios).getByText('14.5')).toBeInTheDocument()
        fireEvent.click(screen.getByText('Ver tabla de etiquetas'))
        const tablaTags = screen.getByRole('table', { name: /Diez etiquetas más frecuentes/i })
        expect(within(tablaTags).getAllByRole('rowheader').map((n) => n.textContent)).toEqual(['wifi', 'filtracion'])
        expect(peticiones).toHaveLength(3)
        // El alcance del coordinador es aplicado por el backend; no enviamos areas ni role desde el cliente.
        expect(peticiones.every((p) => !p.filtros.has('area') && !p.filtros.has('alcance'))).toBe(true)
    })

    it('aplica filtro periodo y categoría a las tres secciones', async () => {
        const { peticiones } = preparar()
        await screen.findByLabelText('Abiertas: 11')
        const persona = userEvent.setup()
        fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01' } })
        fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-24' } })
        await persona.selectOptions(screen.getByLabelText('Categoría'), 'computo_redes')
        await persona.click(screen.getByRole('button', { name: 'Aplicar filtros' }))
        await waitFor(() => expect(peticiones).toHaveLength(6))
        for (const peticion of peticiones.slice(3)) {
            expect(peticion.filtros.get('desde')).toBe('2026-10-01')
            expect(peticion.filtros.get('hasta')).toBe('2026-10-24')
            expect(peticion.filtros.get('categoria')).toBe('computo_redes')
        }
        expect(new Set(peticiones.slice(3).map((p) => p.ruta))).toEqual(new Set(['resumen', 'edificios', 'tags']))
        expect(screen.getByText(/Filtros aplicados al resumen/)).toBeInTheDocument()
        await persona.click(screen.getByRole('button', { name: 'Limpiar' }))
        expect(screen.getByLabelText('Desde')).toHaveValue('')
        expect(screen.getByLabelText('Categoría')).toHaveValue('')
    })

    it('estado vacío sin datos y sugerencias útiles', async () => {
        preparar({
            resumen: { abiertas: 0, en_proceso: 0, criticas: 0, resueltas_periodo: 0 },
            edificios: [], tags: [],
        })
        expect(await screen.findByLabelText('Abiertas: 0')).toBeInTheDocument()
        expect(await screen.findByText('Sin resultados para los filtros seleccionados')).toBeInTheDocument()
        expect(screen.getByText('Sin datos por edificio')).toBeInTheDocument()
        expect(screen.getByText('Sin etiquetas')).toBeInTheDocument()
    })

    it('no envía rango inválido y informa el error del filtro', async () => {
        const { peticiones } = preparar()
        await screen.findByLabelText('Abiertas: 11')
        fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-24' } })
        fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-01' } })
        expect(screen.getByRole('button', { name: 'Aplicar filtros' })).toBeDisabled()
        expect(screen.getByText('Desde debe ser igual o anterior a Hasta')).toBeInTheDocument()
        expect(peticiones).toHaveLength(3)
    })

    it('muestra errores por sección sin ocultar las otras secciones', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => { })
        preparar({}, 'tags')
        expect(await screen.findByLabelText('Abiertas: 11')).toBeInTheDocument()
        expect(await screen.findByText('Reintentar')).toBeInTheDocument()
        expect(screen.getByText('Ver tabla de horas por edificio')).toBeInTheDocument()
    })
})

describe('Caché de analítica T-056', () => {
    it('distingue claves filtradas y conserva esquema Zod de resumen', () => {
        expect(analiticaResumenQuery({ categoria: 'academico' }).queryKey).not.toEqual(analiticaResumenQuery({}).queryKey)
        expect(analiticaEdificiosQuery({ desde: '2026-10-01' }).queryKey).not.toEqual(analiticaEdificiosQuery({}).queryKey)
        expect(analiticaTagsQuery({ desde: '2026-10-01' }).queryKey).not.toEqual(analiticaTagsQuery({}).queryKey)
    })
})
