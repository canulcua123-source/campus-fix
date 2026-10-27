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
import { rangoUltimosDias } from '../../lib/fechas'
import { servidor } from '../../test/msw/server'
import Dashboard from '../Dashboard'

const RESUMEN = { abiertas: 11, en_proceso: 4, criticas: 2, resueltas_periodo: 6 }
const EDIFICIOS = [
    { edificio: 'A', total: 3, horas_invertidas: 14.5, horas_resolucion_prom: 8.2 },
    { edificio: 'B', total: 2, horas_invertidas: 9, horas_resolucion_prom: null },
]
const TAGS = [{ tag: 'wifi', total: 7 }, { tag: 'filtracion', total: 3 }]
const TENDENCIA = [
    { periodo: '2026-09', categoria: 'computo_redes', total: 3 },
    { periodo: '2026-10', categoria: 'infraestructura', total: 2 },
]
const AULAS = [{ edificio: 'A', piso: 2, aula: '204', total: 4 }]
const rutas = {
    resumen: `${BASE}/analitica/resumen`,
    edificios: `${BASE}/analitica/edificios`,
    tags: `${BASE}/analitica/tags`,
    tendencia: `${BASE}/analitica/tendencia`,
    aulas: `${BASE}/analitica/aulas-cronicas`,
}
type Mocks = { resumen?: typeof RESUMEN; edificios?: typeof EDIFICIOS; tags?: typeof TAGS; tendencia?: typeof TENDENCIA; aulas?: typeof AULAS }
const POR_DEFECTO = { resumen: RESUMEN, edificios: EDIFICIOS, tags: TAGS, tendencia: TENDENCIA, aulas: AULAS }

/** Valor mostrado por el StatTile cuya etiqueta es `etiqueta`. */
const tile = (etiqueta: string) => screen.getByText(etiqueta, { selector: '.ui-stat__etiqueta' }).closest('.ui-stat') as HTMLElement
const valorDe = (etiqueta: string) => tile(etiqueta).querySelector('.ui-stat__valor')?.textContent

function preparar(
    mocks: Mocks = {},
    seccionConError?: keyof typeof rutas,
) {
    const peticiones: { ruta: string; filtros: URLSearchParams }[] = []
    for (const [tipo, url] of Object.entries(rutas)) {
        servidor.use(http.get(url, ({ request }) => {
            peticiones.push({ ruta: tipo, filtros: new URL(request.url).searchParams })
            if (tipo === seccionConError) return HttpResponse.json({ error: 'no_disponible' }, { status: 503 })
            const clave = tipo as keyof typeof POR_DEFECTO
            return HttpResponse.json(mocks[clave] ?? POR_DEFECTO[clave])
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
        await waitFor(() => expect(valorDe('Abiertas')).toBe('11'))
        expect(valorDe('En proceso')).toBe('4')
        expect(valorDe('Críticas')).toBe('2')
        expect(valorDe('Resueltas')).toBe('6')
        expect(screen.getByRole('group', { name: 'Indicadores principales' })).toBeInTheDocument()
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
        const aulas = await screen.findByRole('table', { name: 'Aulas con incidencias recurrentes' })
        expect(within(aulas).getByRole('rowheader', { name: '204' })).toBeInTheDocument()
        expect(await screen.findByText('Ver tabla de tendencia')).toBeInTheDocument()
        expect(peticiones).toHaveLength(5)
        // Por defecto: últimos 30 días.
        const { desde, hasta } = rangoUltimosDias(30)
        expect(peticiones.every((p) => p.filtros.get('desde') === desde && p.filtros.get('hasta') === hasta)).toBe(true)
        // El alcance del coordinador es aplicado por el backend; no enviamos areas ni role desde el cliente.
        expect(peticiones.every((p) => !p.filtros.has('area') && !p.filtros.has('alcance'))).toBe(true)
    })

    it('aplica periodo personalizado y categoría a todas las secciones sin botón Aplicar', async () => {
        const { peticiones } = preparar()
        await waitFor(() => expect(valorDe('Abiertas')).toBe('11'))
        const persona = userEvent.setup()
        expect(screen.queryByRole('button', { name: 'Aplicar filtros' })).not.toBeInTheDocument()
        await persona.click(screen.getByRole('button', { name: 'Personalizado' }))
        fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01' } })
        fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-24' } })
        await persona.selectOptions(screen.getByLabelText('Categoría'), 'computo_redes')
        const completas = () => peticiones.filter((p) =>
            p.filtros.get('desde') === '2026-10-01' && p.filtros.get('hasta') === '2026-10-24' && p.filtros.get('categoria') === 'computo_redes')
        await waitFor(() => expect(completas()).toHaveLength(5))
        expect(new Set(completas().map((p) => p.ruta))).toEqual(new Set(Object.keys(rutas)))
        await persona.click(screen.getByRole('button', { name: 'Limpiar' }))
        expect(screen.getByLabelText('Categoría')).toHaveValue('')
        expect(screen.getByRole('button', { name: '30 días' })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.queryByLabelText('Desde')).not.toBeInTheDocument()
    })

    it('un atajo de periodo se aplica al instante', async () => {
        const { peticiones } = preparar()
        await waitFor(() => expect(valorDe('Abiertas')).toBe('11'))
        await userEvent.click(screen.getByRole('button', { name: '7 días' }))
        const { desde } = rangoUltimosDias(7)
        await waitFor(() => expect(peticiones.filter((p) => p.filtros.get('desde') === desde)).toHaveLength(5))
        expect(screen.getByRole('button', { name: '7 días' })).toHaveAttribute('aria-pressed', 'true')
    })

    it('estado vacío sin datos y sugerencias útiles', async () => {
        preparar({
            resumen: { abiertas: 0, en_proceso: 0, criticas: 0, resueltas_periodo: 0 },
            edificios: [], tags: [], tendencia: [], aulas: [],
        })
        expect(await screen.findByText('Sin resultados para los filtros seleccionados')).toBeInTheDocument()
        expect(valorDe('Abiertas')).toBe('0')
        // Un solo estado vacío en lugar de uno por sección.
        expect(screen.queryByText('Sin datos por edificio')).not.toBeInTheDocument()
        expect(screen.queryByText('Sin etiquetas')).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Ver últimos 90 días' })).toBeInTheDocument()
    })

    it('no envía rango inválido y informa el error del filtro', async () => {
        const { peticiones } = preparar()
        await waitFor(() => expect(valorDe('Abiertas')).toBe('11'))
        await userEvent.click(screen.getByRole('button', { name: 'Personalizado' }))
        fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-01-10' } })
        await waitFor(() => expect(peticiones.filter((p) => p.filtros.get('desde') === '2026-01-10')).toHaveLength(5))
        const antes = peticiones.length
        fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-01-05' } })
        expect(screen.getByText('Desde debe ser igual o anterior a Hasta')).toBeInTheDocument()
        await new Promise((r) => setTimeout(r, 50))
        expect(peticiones).toHaveLength(antes)
        expect(peticiones.some((p) => p.filtros.get('hasta') === '2026-01-05')).toBe(false)
    })

    it('muestra errores por sección sin ocultar las otras secciones', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => { })
        preparar({}, 'tags')
        await waitFor(() => expect(valorDe('Abiertas')).toBe('11'))
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
