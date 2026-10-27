import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  Camera, CircleDollarSign, Gauge, PencilLine, RefreshCw, SlidersHorizontal, Sparkles, Timer, TriangleAlert, Undo2, Wrench, Workflow,
} from 'lucide-react'
import { metricasIAQuery } from '../api/metricasIA'
import { mensajeDeError } from '../api/client'
import { CompuertasIA } from '../components/graficas/CompuertasIA'
import { CostosIA } from '../components/graficas/CostosIA'
import {
  BarraFiltros, Button, EmptyState, ErrorState, Input, PageHeader, RangoFechas, Seccion, Select, Skeleton, Spinner, StatGrid,
  StatTile, Tabla, claseNumerica, type TonoStat, type ValorRango,
} from '../components/ui'
import { rangoUltimosDias } from '../lib/fechas'
import { ETIQUETAS_CATEGORIA } from '../schemas/etiquetas'
import { CATEGORIAS } from '../schemas/incidencia'
import type { FiltrosMetricasIA, MetricasIA } from '../schemas/metricasIA'

type Texto = { proveedor: string; modelo: string }
const SIN_TEXTO: Texto = { proveedor: '', modelo: '' }
const OPCIONES_CATEGORIA = CATEGORIAS.map((clave) => ({ valor: clave, texto: ETIQUETAS_CATEGORIA[clave] }))
const numero = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 })
const dinero = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'USD', maximumFractionDigits: 6 })
// `semana` es el lunes (día calendario UTC) de cada semana: se formatea en UTC.
const formatoSemana = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const semana = (iso: string) => formatoSemana.format(new Date(`${iso}T00:00:00Z`))
const rangoInicial = () => rangoUltimosDias(30)
const OBJETIVO_TOQUE_MS = 20_000

function textoTasa(tasa: MetricasIA['tasa_deshacer']) {
  if (!tasa.disponible) return 'No disponible'
  return tasa.porcentaje === null ? 'Sin datos' : `${numero.format(tasa.porcentaje)} %`
}

function textoMilisegundos(valor: number | null) {
  return valor === null ? 'Sin datos' : `${numero.format(valor / 1000)} s`
}

/** Sin ofertas, llamadas a la IA ni costo: no hay nada que medir todavía. */
function sinTelemetria(m: MetricasIA) {
  return m.totales.ofertas === 0 && m.latencia_ia.muestras === 0 && m.costos.llamadas_con_costo === 0 &&
    m.compuertas_fallidas.length === 0
}

export default function MetricasIA() {
  const [rango, setRango] = useState<ValorRango>(rangoInicial)
  const [rangoAplicado, setRangoAplicado] = useState<ValorRango>(rangoInicial)
  const [categoria, setCategoria] = useState('')
  const [borradorTexto, setBorradorTexto] = useState<Texto>(SIN_TEXTO)
  const [texto, setTexto] = useState<Texto>(SIN_TEXTO)
  const [masFiltros, setMasFiltros] = useState(false)
  const [versionRango, setVersionRango] = useState(0)
  const fechasInvertidas = Boolean(rango.desde && rango.hasta && rango.desde > rango.hasta)
  const textoPendiente = borradorTexto.proveedor.trim() !== texto.proveedor || borradorTexto.modelo.trim() !== texto.modelo

  const filtros = Object.fromEntries(Object.entries({
    desde: rangoAplicado.desde, hasta: rangoAplicado.hasta, categoria, proveedor: texto.proveedor, modelo: texto.modelo,
  }).filter(([, valor]) => valor)) as FiltrosMetricasIA
  // keepPreviousData: al filtrar se conservan (atenuados) los datos anteriores hasta que llega la consulta nueva.
  const consulta = useQuery({ ...metricasIAQuery(filtros), placeholderData: keepPreviousData })
  const filtrando = consulta.isPlaceholderData
  const actualizando = filtrando || (consulta.isFetching && !consulta.isPending)

  function cambiarRango(siguiente: ValorRango) {
    setRango(siguiente)
    if (!(siguiente.desde && siguiente.hasta && siguiente.desde > siguiente.hasta)) setRangoAplicado(siguiente)
  }

  function aplicarTexto() {
    setTexto({ proveedor: borradorTexto.proveedor.trim(), modelo: borradorTexto.modelo.trim() })
  }

  function limpiar() {
    const r = rangoInicial()
    setRango(r)
    setRangoAplicado(r)
    setCategoria('')
    setBorradorTexto(SIN_TEXTO)
    setTexto(SIN_TEXTO)
    setVersionRango((v) => v + 1)
  }

  const activos = (categoria ? 1 : 0) + (texto.proveedor ? 1 : 0) + (texto.modelo ? 1 : 0) +
    (rangoAplicado.desde !== rangoInicial().desde || rangoAplicado.hasta !== rangoInicial().hasta ? 1 : 0)
  const extrasActivos = (texto.proveedor ? 1 : 0) + (texto.modelo ? 1 : 0)

  return (
    <div className="pila">
      <PageHeader
        titulo="Métricas de IA"
        subtitulo="Calidad, latencia y costo estimado del análisis de fotos. Solo datos agregados."
        acciones={(
          <Button
            variante="secundario" tamano="sm" icono={<RefreshCw size={16} aria-hidden />}
            cargando={actualizando && !filtrando} textoCargando="Actualizando…" onClick={() => { void consulta.refetch() }}
          >Actualizar</Button>
        )}
      />

      <BarraFiltros
        etiqueta="Filtros de métricas de IA"
        activos={activos}
        onEnviar={aplicarTexto}
        acciones={(
          <>
            <span role="status" className="flex items-center gap-2 text-sm text-muted">
              {actualizando && <><Spinner tamano={16} etiqueta={null} /> Actualizando…</>}
            </span>
            <Button
              tamano="sm" variante="fantasma" icono={<SlidersHorizontal size={16} aria-hidden />}
              aria-expanded={masFiltros} onClick={() => setMasFiltros((v) => !v)}
            >{extrasActivos ? `Más filtros (${extrasActivos})` : 'Más filtros'}</Button>
            {masFiltros && <Button tamano="sm" type="submit" disabled={!textoPendiente}>Aplicar filtros</Button>}
            <Button tamano="sm" variante="fantasma" onClick={limpiar}>Limpiar</Button>
          </>
        )}
      >
        <RangoFechas key={versionRango} valor={rango} onCambio={cambiarRango} />
        <Select
          etiqueta="Categoría" tamano="sm" value={categoria} placeholder="Todas"
          opciones={OPCIONES_CATEGORIA} onChange={(e) => setCategoria(e.target.value)}
        />
        {masFiltros && (
          <>
            <Input
              etiqueta="Proveedor" tamano="sm" value={borradorTexto.proveedor} maxLength={30} placeholder="Ej. claude"
              onChange={(e) => setBorradorTexto((a) => ({ ...a, proveedor: e.target.value }))}
            />
            <Input
              etiqueta="Modelo" tamano="sm" value={borradorTexto.modelo} maxLength={100} placeholder="Modelo exacto"
              onChange={(e) => setBorradorTexto((a) => ({ ...a, modelo: e.target.value }))}
            />
          </>
        )}
      </BarraFiltros>
      {fechasInvertidas && <p role="alert" className="campo-error m-0">Desde debe ser igual o anterior a Hasta</p>}

      {consulta.isPending ? (
        <div role="status" aria-label="Cargando métricas de IA" className="pila">
          <StatGrid columnas={4}>
            {Array.from({ length: 4 }, (_, i) => <StatTile key={i} etiqueta="Cargando" valor="" cargando />)}
          </StatGrid>
          <Skeleton alto={240} />
        </div>
      ) : consulta.isError ? (
        <ErrorState mensaje={mensajeDeError(consulta.error)} onReintentar={() => { void consulta.refetch() }} reintentando={consulta.isFetching} />
      ) : (
        <div className="pila transition-opacity duration-200" style={{ opacity: filtrando ? 0.55 : 1 }} aria-busy={actualizando}>
          {sinTelemetria(consulta.data) ? (
            <EmptyState
              icono={Sparkles}
              titulo="Aún no hay telemetría de IA"
              descripcion="Las métricas aparecen cuando se reportan incidencias con foto y la IA las analiza. Prueba con un periodo más amplio o quita los filtros."
              accion={activos > 0 ? <Button tamano="sm" variante="secundario" onClick={limpiar}>Quitar filtros</Button> : undefined}
            />
          ) : (
            <Contenido metricas={consulta.data} />
          )}
        </div>
      )}
    </div>
  )
}

function Contenido({ metricas }: { metricas: MetricasIA }) {
  const { costos } = metricas
  const p95Toque = metricas.tiempo_toque_folio.p95_ms
  const tonoToque: TonoStat = p95Toque === null ? 'neutral' : p95Toque <= OBJETIVO_TOQUE_MS ? 'success' : 'warning'
  return (
    <>
      {costos.alerta.activa && (
        <div role="alert" className="ui-seccion flex items-start gap-3 p-4" style={{ borderColor: 'var(--color-warning)' }}>
          <TriangleAlert size={20} className="mt-0.5 shrink-0" style={{ color: 'var(--color-warning)' }} aria-hidden />
          <div>
            <h2 className="m-0 text-base font-semibold">Umbral diario de costo superado</h2>
            <p className="m-0 text-sm text-muted">
              Más de {dinero.format(costos.alerta.umbral_diario_usd ?? 0)} en {costos.alerta.dias_excedidos.length} día(s). Costo estimado, no facturado.
            </p>
          </div>
        </div>
      )}

      <StatGrid columnas={4} etiqueta="Indicadores principales">
        <StatTile etiqueta="Ofertas" valor={numero.format(metricas.totales.ofertas)} icono={<Sparkles />} tono="brand" pista={`${numero.format(metricas.totales.enviadas)} enviadas`} />
        <StatTile etiqueta="Tasa de deshacer" valor={textoTasa(metricas.tasa_deshacer)} icono={<Undo2 />} pista={`${metricas.tasa_deshacer.numerador} de ${metricas.tasa_deshacer.denominador}`} />
        <StatTile etiqueta="Tasa de edición" valor={textoTasa(metricas.tasa_edicion)} icono={<PencilLine />} pista={`${metricas.tasa_edicion.numerador} editadas`} />
        <StatTile etiqueta="Corrección técnica ≤72 h" valor={textoTasa(metricas.correccion_tecnica_72h)} icono={<Wrench />} pista={metricas.correccion_tecnica_72h.motivo ?? 'Cambios de categoría o prioridad'} />
        <StatTile etiqueta="Cobertura agéntica" valor={textoTasa(metricas.cobertura_agentica)} icono={<Camera />} pista={`${metricas.cobertura_agentica.numerador} de ${metricas.cobertura_agentica.denominador} con foto`} />
        <StatTile etiqueta="Toque → folio p95" valor={textoMilisegundos(p95Toque)} icono={<Gauge />} tono={tonoToque} pista={`Objetivo ≤ 20 s · ${metricas.tiempo_toque_folio.muestras} mediciones`} />
        <StatTile etiqueta="Latencia IA p95" valor={textoMilisegundos(metricas.latencia_ia.p95_ms)} icono={<Timer />} pista={`Promedio ${textoMilisegundos(metricas.latencia_ia.promedio_ms)} · ${metricas.errores_ia + metricas.timeouts_ia} fallos`} />
        <StatTile
          etiqueta="Costo estimado" icono={<CircleDollarSign />} tono={costos.alerta.activa ? 'warning' : 'neutral'}
          valor={costos.costo_estimado_periodo_usd === null ? 'Sin datos' : dinero.format(costos.costo_estimado_periodo_usd)}
          pista={`${costos.llamadas_con_costo} llamadas con costo`}
        />
      </StatGrid>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Seccion titulo="Costo estimado diario" descripcion="Estimado con tokens informados; no es costo facturado.">
          {costos.diario.length ? <CostosIA datos={costos.diario} />
            : <EmptyState compacto icono={CircleDollarSign} titulo="Costo no disponible" descripcion="El proveedor aún no informó tokens o costo para este periodo." />}
        </Seccion>
        <Seccion titulo="Compuertas fallidas" descripcion="Validaciones G1–G9 que detuvieron una oferta.">
          {metricas.compuertas_fallidas.length ? <CompuertasIA datos={metricas.compuertas_fallidas} />
            : <EmptyState compacto icono={Workflow} titulo="Sin compuertas fallidas" descripcion="Ninguna validación falló en este periodo." />}
        </Seccion>
      </div>

      <Seccion titulo="Resumen semanal" sinPadding={metricas.semanal.length > 0}>
        {metricas.semanal.length === 0 ? <EmptyState compacto titulo="Sin resumen semanal" descripcion="No hay ofertas para agrupar." /> : (
          <Tabla etiqueta="Ofertas, decisiones y costo estimado por semana" apilada densa>
            <thead>
              <tr>
                <th scope="col">Semana</th>
                <th scope="col" className={claseNumerica}>Ofertas</th>
                <th scope="col" className={claseNumerica}>Deshechas</th>
                <th scope="col" className={claseNumerica}>Editadas</th>
                <th scope="col" className={claseNumerica}>Costo estimado</th>
              </tr>
            </thead>
            <tbody>{metricas.semanal.map((fila) => (
              <tr key={fila.semana}>
                <th scope="row" data-label="Semana">{semana(fila.semana)}</th>
                <td data-label="Ofertas" className={claseNumerica}>{fila.ofertas}</td>
                <td data-label="Deshechas" className={claseNumerica}>{fila.deshechas}</td>
                <td data-label="Editadas" className={claseNumerica}>{fila.editadas}</td>
                <td data-label="Costo estimado" className={claseNumerica}>{fila.costo_estimado_usd === null ? 'Sin datos' : dinero.format(fila.costo_estimado_usd)}</td>
              </tr>
            ))}</tbody>
          </Tabla>
        )}
      </Seccion>
    </>
  )
}
