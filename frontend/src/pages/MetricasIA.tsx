import { useState, type FormEvent } from 'react'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import { useMetricasIA } from '../api/hooks/metricasIA'
import { mensajeDeError } from '../api/client'
import { CompuertasIA } from '../components/graficas/CompuertasIA'
import { CostosIA } from '../components/graficas/CostosIA'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input, Select } from '../components/ui/Campo'
import { EmptyState } from '../components/ui/EmptyState'
import { ErrorState } from '../components/ui/ErrorState'
import { PageHeader } from '../components/ui/PageHeader'
import { Skeleton } from '../components/ui/Skeleton'
import { ETIQUETAS_CATEGORIA } from '../schemas/etiquetas'
import { CATEGORIAS } from '../schemas/incidencia'
import type { FiltrosMetricasIA, MetricasIA } from '../schemas/metricasIA'

type Borrador = Required<FiltrosMetricasIA>
const SIN_FILTROS: Borrador = { desde: '', hasta: '', categoria: '', proveedor: '', modelo: '' }
const numero = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 })
const dinero = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'USD', maximumFractionDigits: 6 })

function textoTasa(tasa: MetricasIA['tasa_deshacer']) {
  if (!tasa.disponible) return 'No disponible'
  return tasa.porcentaje === null ? 'Sin datos' : `${numero.format(tasa.porcentaje)} %`
}

function textoMilisegundos(valor: number | null) {
  return valor === null ? 'Sin datos' : `${numero.format(valor / 1000)} s`
}

function Kpi({ titulo, valor, detalle }: { titulo: string; valor: string; detalle: string }) {
  return (
    <Card como="article" className="flex flex-col gap-1">
      <h3 className="text-sm font-semibold text-muted">{titulo}</h3>
      <p className="text-2xl font-bold text-ink" aria-label={`${titulo}: ${valor}`}>{valor}</p>
      <p className="text-xs text-muted">{detalle}</p>
    </Card>
  )
}

export default function MetricasIA() {
  const [borrador, setBorrador] = useState<Borrador>(SIN_FILTROS)
  const [filtros, setFiltros] = useState<FiltrosMetricasIA>({})
  const consulta = useMetricasIA(filtros)
  const fechasInvertidas = Boolean(borrador.desde && borrador.hasta && borrador.desde > borrador.hasta)

  function aplicar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (fechasInvertidas) return
    setFiltros(Object.fromEntries(Object.entries(borrador).filter(([, valor]) => valor)) as FiltrosMetricasIA)
  }

  function limpiar() {
    setBorrador(SIN_FILTROS)
    setFiltros({})
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader titulo="Métricas de IA" subtitulo="Auditoría agregada de ofertas, calidad, latencia y costo estimado" />
      <p className="text-sm text-muted" role="note">Esta pantalla es exclusiva del rol administrador. No muestra eventos individuales ni datos personales.</p>

      <Card como="section" aria-label="Filtros de métricas de IA" className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Filtrar métricas</h2>
        <form onSubmit={aplicar} className="grid gap-3 md:grid-cols-2 xl:grid-cols-5 xl:items-end">
          <Input etiqueta="Desde" type="date" value={borrador.desde} max={borrador.hasta || undefined}
            onChange={(e) => setBorrador((anterior) => ({ ...anterior, desde: e.target.value }))}
            error={fechasInvertidas ? 'Desde debe ser igual o anterior a Hasta' : undefined} />
          <Input etiqueta="Hasta" type="date" value={borrador.hasta} min={borrador.desde || undefined}
            onChange={(e) => setBorrador((anterior) => ({ ...anterior, hasta: e.target.value }))} />
          <Select etiqueta="Categoría" value={borrador.categoria} placeholder="Todas las categorías"
            opciones={CATEGORIAS.map((clave) => ({ valor: clave, texto: ETIQUETAS_CATEGORIA[clave] }))}
            onChange={(e) => setBorrador((anterior) => ({ ...anterior, categoria: e.target.value }))} />
          <Input etiqueta="Proveedor" value={borrador.proveedor} maxLength={30} placeholder="Ej. claude"
            onChange={(e) => setBorrador((anterior) => ({ ...anterior, proveedor: e.target.value }))} />
          <Input etiqueta="Modelo" value={borrador.modelo} maxLength={100} placeholder="Modelo exacto"
            onChange={(e) => setBorrador((anterior) => ({ ...anterior, modelo: e.target.value }))} />
          <div className="flex flex-wrap gap-2 xl:col-span-5">
            <Button type="submit" disabled={fechasInvertidas}>Aplicar filtros</Button>
            <Button variante="secundario" onClick={limpiar}>Limpiar</Button>
          </div>
        </form>
        <p className="text-xs text-muted">Sin fechas se consultan los últimos 30 días. El máximo permitido es 180 días.</p>
      </Card>

      {consulta.isPending ? (
        <div role="status" aria-label="Cargando métricas de IA" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, indice) => <Card key={indice}><Skeleton ancho="55%" /><Skeleton ancho="40%" alto={32} /></Card>)}
        </div>
      ) : consulta.isError ? (
        <ErrorState mensaje={mensajeDeError(consulta.error)} onReintentar={() => { void consulta.refetch() }} reintentando={consulta.isFetching} />
      ) : (
        <Contenido metricas={consulta.data} />
      )}

      <div className="flex justify-end">
        <Button variante="fantasma" icono={<RefreshCw size={18} />} onClick={() => { void consulta.refetch() }}>Actualizar métricas</Button>
      </div>
    </div>
  )
}

function Contenido({ metricas }: { metricas: MetricasIA }) {
  const sinOfertas = metricas.totales.ofertas === 0
  return (
    <>
      {metricas.costos.alerta.activa && (
        <Card como="section" role="alert" className="flex items-start gap-3 border-[var(--color-warning)]">
          <TriangleAlert className="shrink-0 text-[var(--color-warning)]" aria-hidden />
          <div><h2 className="font-semibold">Umbral diario de costo superado</h2>
            <p className="text-sm text-muted">El costo estimado superó {dinero.format(metricas.costos.alerta.umbral_diario_usd ?? 0)} en {metricas.costos.alerta.dias_excedidos.length} día(s). No representa costo facturado.</p></div>
        </Card>
      )}
      <section aria-labelledby="ia-kpis" className="flex flex-col gap-3">
        <h2 id="ia-kpis" className="text-lg font-semibold">Indicadores principales</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi titulo="Ofertas" valor={numero.format(metricas.totales.ofertas)} detalle="Ofertas agénticas auditadas" />
          <Kpi titulo="Tasa de deshacer" valor={textoTasa(metricas.tasa_deshacer)} detalle={`${metricas.tasa_deshacer.numerador} de ${metricas.tasa_deshacer.denominador} ofertas`} />
          <Kpi titulo="Tasa de edición" valor={textoTasa(metricas.tasa_edicion)} detalle={`${metricas.tasa_edicion.numerador} ofertas editadas una sola vez`} />
          <Kpi titulo="Corrección técnica ≤72 h" valor={textoTasa(metricas.correccion_tecnica_72h)} detalle={metricas.correccion_tecnica_72h.motivo ?? 'Cambios de categoría o prioridad'} />
          <Kpi titulo="Cobertura agéntica" valor={textoTasa(metricas.cobertura_agentica)} detalle={`${metricas.cobertura_agentica.numerador} de ${metricas.cobertura_agentica.denominador} reportes con foto`} />
          <Kpi titulo="Toque → folio p95" valor={textoMilisegundos(metricas.tiempo_toque_folio.p95_ms)} detalle={`${metricas.tiempo_toque_folio.muestras} mediciones confiables; objetivo ≤ 20 s`} />
          <Kpi titulo="Latencia IA p95" valor={textoMilisegundos(metricas.latencia_ia.p95_ms)} detalle={`${metricas.latencia_ia.muestras} llamadas; promedio ${textoMilisegundos(metricas.latencia_ia.promedio_ms)}`} />
          <Kpi titulo="Costo estimado" valor={metricas.costos.costo_estimado_periodo_usd === null ? 'Sin datos' : dinero.format(metricas.costos.costo_estimado_periodo_usd)} detalle={`${metricas.costos.llamadas_con_costo} llamadas con costo informado`} />
        </div>
      </section>

      {sinOfertas && <EmptyState titulo="Aún no hay telemetría de IA" descripcion="No existen ofertas auditadas para los filtros seleccionados. No se muestran valores inventados." />}

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card como="section" className="flex flex-col gap-3" aria-labelledby="costos-ia">
          <h2 id="costos-ia" className="text-lg font-semibold">Costo estimado diario</h2>
          {metricas.costos.diario.length ? <CostosIA datos={metricas.costos.diario} />
            : <EmptyState titulo="Costo no disponible" descripcion="El proveedor todavía no entregó tokens o costo confiable para este periodo." />}
        </Card>
        <Card como="section" className="flex flex-col gap-3" aria-labelledby="compuertas-ia">
          <h2 id="compuertas-ia" className="text-lg font-semibold">Compuertas fallidas</h2>
          {metricas.compuertas_fallidas.length ? <CompuertasIA datos={metricas.compuertas_fallidas} />
            : <EmptyState titulo="Sin compuertas fallidas" descripcion="No hay identificadores G1–G9 registrados para este periodo." />}
        </Card>
      </div>

      <Card como="section" className="flex flex-col gap-3" aria-labelledby="semanal-ia">
        <h2 id="semanal-ia" className="text-lg font-semibold">Resumen semanal</h2>
        {metricas.semanal.length === 0 ? <EmptyState titulo="Sin resumen semanal" descripcion="No hay ofertas para agrupar." /> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <caption className="py-2 text-left text-muted">Ofertas, decisiones y costo estimado por semana UTC</caption>
            <thead><tr><th scope="col" className="p-2">Semana</th><th scope="col" className="p-2">Ofertas</th><th scope="col" className="p-2">Deshechas</th><th scope="col" className="p-2">Editadas</th><th scope="col" className="p-2">Costo estimado</th></tr></thead>
            <tbody>{metricas.semanal.map((fila) => <tr key={fila.semana} className="border-t border-[var(--color-border)]">
              <th scope="row" className="p-2">{fila.semana}</th><td className="p-2">{fila.ofertas}</td><td className="p-2">{fila.deshechas}</td><td className="p-2">{fila.editadas}</td><td className="p-2">{fila.costo_estimado_usd === null ? 'Sin datos' : dinero.format(fila.costo_estimado_usd)}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Card>
    </>
  )
}
