import { useState, type FormEvent } from 'react'
import { RefreshCw } from 'lucide-react'
import { useAnalitica } from '../api/hooks/analitica'
import { mensajeDeError } from '../api/client'
import { useAuth } from '../auth/store'
import { HorasEdificio } from '../components/graficas/HorasEdificio'
import { TopTags } from '../components/graficas/TopTags'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input, Select } from '../components/ui/Campo'
import { EmptyState } from '../components/ui/EmptyState'
import { ErrorState } from '../components/ui/ErrorState'
import { PageHeader } from '../components/ui/PageHeader'
import { Skeleton } from '../components/ui/Skeleton'
import { ETIQUETAS_CATEGORIA } from '../schemas/etiquetas'
import { CATEGORIAS } from '../schemas/incidencia'
import type { FiltrosAnalitica, ResumenAnalitica } from '../schemas/analitica'

type BorradorFiltros = { desde: string; hasta: string; categoria: string }
const SIN_FILTROS: BorradorFiltros = { desde: '', hasta: '', categoria: '' }

const KPIS: { clave: keyof ResumenAnalitica; etiqueta: string; descripcion: string }[] = [
  { clave: 'abiertas', etiqueta: 'Abiertas', descripcion: 'Incidencias que esperan atención' },
  { clave: 'en_proceso', etiqueta: 'En proceso', descripcion: 'Incidencias en seguimiento' },
  { clave: 'criticas', etiqueta: 'Críticas', descripcion: 'Incidencias de prioridad crítica' },
  { clave: 'resueltas_periodo', etiqueta: 'Resueltas', descripcion: 'Resueltas dentro del periodo seleccionado' },
]

const numero = new Intl.NumberFormat('es-MX')

export default function Dashboard() {
  const usuario = useAuth((s) => s.usuario)
  const [borrador, setBorrador] = useState<BorradorFiltros>(SIN_FILTROS)
  const [filtros, setFiltros] = useState<FiltrosAnalitica>({})
  const { resumen, edificios, tags } = useAnalitica(filtros)
  const fechasInvertidas = Boolean(borrador.desde && borrador.hasta && borrador.desde > borrador.hasta)
  const hayFiltros = Boolean(filtros.desde || filtros.hasta || filtros.categoria)
  const todasCargadas = resumen.isSuccess && edificios.isSuccess && tags.isSuccess
  const sinResultados = todasCargadas &&
    Object.values(resumen.data).every((valor) => valor === 0) &&
    edificios.data.length === 0 && tags.data.length === 0

  function aplicarFiltros(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (fechasInvertidas) return
    setFiltros({
      ...(borrador.desde ? { desde: borrador.desde } : {}),
      ...(borrador.hasta ? { hasta: borrador.hasta } : {}),
      ...(borrador.categoria ? { categoria: borrador.categoria as FiltrosAnalitica['categoria'] } : {}),
    })
  }

  function limpiar() {
    setBorrador(SIN_FILTROS)
    setFiltros({})
  }

  const alcance = usuario?.alcance === 'area'
    ? 'Los resultados se limitan a tu área asignada.'
    : usuario?.alcance === 'edificio'
      ? 'Los resultados se limitan a tus edificios asignados.'
      : usuario?.alcance === 'propio'
        ? 'Los resultados se limitan a tus incidencias.'
        : 'Los resultados respetan los permisos de tu cuenta.'

  return (
    <div className="flex flex-col gap-5">
      <PageHeader titulo="Panel de analítica" subtitulo="Indicadores y tendencias de incidencias reales del campus" />
      <p className="text-sm text-muted" role="note">{alcance}</p>

      <Card como="section" aria-label="Filtros del dashboard" className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Filtrar estadísticas</h2>
        <form onSubmit={aplicarFiltros} className="grid gap-3 md:grid-cols-4 md:items-end">
          <Input
            etiqueta="Desde" type="date" value={borrador.desde} max={borrador.hasta || undefined}
            onChange={(e) => setBorrador((prev) => ({ ...prev, desde: e.target.value }))}
            error={fechasInvertidas ? 'Desde debe ser igual o anterior a Hasta' : undefined}
          />
          <Input
            etiqueta="Hasta" type="date" value={borrador.hasta} min={borrador.desde || undefined}
            onChange={(e) => setBorrador((prev) => ({ ...prev, hasta: e.target.value }))}
          />
          <Select
            etiqueta="Categoría" value={borrador.categoria}
            opciones={CATEGORIAS.map((clave) => ({ valor: clave, texto: ETIQUETAS_CATEGORIA[clave] }))}
            placeholder="Todas las categorías"
            onChange={(e) => setBorrador((prev) => ({ ...prev, categoria: e.target.value }))}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={fechasInvertidas}>Aplicar filtros</Button>
            <Button variante="secundario" onClick={limpiar}>Limpiar</Button>
          </div>
        </form>
        <p className="text-xs text-muted">
          El periodo usa fechas UTC. Los reportes por edificio usan la fecha de resolución;
          el ranking de etiquetas usa la fecha de creación.
        </p>
        {hayFiltros && <p className="text-sm text-muted" role="status">Filtros aplicados al resumen, edificios y etiquetas.</p>}
      </Card>

      <section aria-labelledby="dashboard-kpis" className="flex flex-col gap-3">
        <h2 id="dashboard-kpis" className="text-lg font-semibold">Indicadores principales</h2>
        {resumen.isPending ? (
          <div role="status" aria-label="Cargando indicadores" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {KPIS.map((kpi) => <Card key={kpi.clave}><Skeleton ancho="50%" /><Skeleton ancho="35%" alto={34} /></Card>)}
          </div>
        ) : resumen.isError ? (
          <ErrorState mensaje={mensajeDeError(resumen.error)} onReintentar={() => { void resumen.refetch() }} reintentando={resumen.isFetching} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {KPIS.map((kpi) => (
              <Card key={kpi.clave} como="article" className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold text-muted">{kpi.etiqueta}</h3>
                <p className="text-3xl font-bold text-ink" aria-label={`${kpi.etiqueta}: ${resumen.data[kpi.clave]}`}>
                  {numero.format(resumen.data[kpi.clave])}
                </p>
                <p className="text-xs text-muted">{kpi.descripcion}</p>
              </Card>
            ))}
          </div>
        )}
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card como="section" aria-labelledby="dashboard-edificios" className="flex flex-col gap-3">
          <h2 id="dashboard-edificios" className="text-lg font-semibold">Horas por edificio</h2>
          <p className="text-sm text-muted">Horas invertidas acumuladas y horas promedio para resolver incidencias.</p>
          {edificios.isPending ? (
            <div role="status" aria-label="Cargando horas por edificio"><Skeleton alto={260} /></div>
          ) : edificios.isError ? (
            <ErrorState mensaje={mensajeDeError(edificios.error)} onReintentar={() => { void edificios.refetch() }} reintentando={edificios.isFetching} />
          ) : edificios.data.length === 0 ? (
            <EmptyState titulo="Sin datos por edificio" descripcion="No hay incidencias resueltas para los filtros aplicados." />
          ) : (
            <HorasEdificio datos={edificios.data} />
          )}
        </Card>

        <Card como="section" aria-labelledby="dashboard-tags" className="flex flex-col gap-3">
          <h2 id="dashboard-tags" className="text-lg font-semibold">Diez etiquetas más frecuentes</h2>
          <p className="text-sm text-muted">Incidencias etiquetadas dentro del periodo seleccionado.</p>
          {tags.isPending ? (
            <div role="status" aria-label="Cargando etiquetas"><Skeleton alto={260} /></div>
          ) : tags.isError ? (
            <ErrorState mensaje={mensajeDeError(tags.error)} onReintentar={() => { void tags.refetch() }} reintentando={tags.isFetching} />
          ) : tags.data.length === 0 ? (
            <EmptyState titulo="Sin etiquetas" descripcion="No hay etiquetas registradas para los filtros aplicados." />
          ) : (
            <TopTags datos={tags.data} />
          )}
        </Card>
      </div>

      {sinResultados && (
        <EmptyState titulo="Sin resultados para los filtros seleccionados" descripcion="Prueba con otro periodo o categoría para consultar más incidencias." />
      )}
      <div className="flex justify-end">
        <Button variante="fantasma" icono={<RefreshCw size={18} />} onClick={() => {
          void resumen.refetch(); void edificios.refetch(); void tags.refetch()
        }}>Actualizar estadísticas</Button>
      </div>
    </div>
  )
}