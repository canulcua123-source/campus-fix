import { useState, type ReactNode } from 'react'
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { CheckCircle2, Clock, FolderOpen, RefreshCw, SearchX, Siren } from 'lucide-react'
import {
  analiticaAulasCronicasQuery, analiticaEdificiosQuery, analiticaResumenQuery, analiticaTagsQuery, analiticaTendenciaQuery,
} from '../api/analitica'
import { mensajeDeError } from '../api/client'
import { useAuth } from '../auth/store'
import { HorasEdificio } from '../components/graficas/HorasEdificio'
import { TendenciaCategorias } from '../components/graficas/TendenciaCategorias'
import { TopTags } from '../components/graficas/TopTags'
import {
  BarraFiltros, Button, EmptyState, ErrorState, PageHeader, RangoFechas, Seccion, Select, Skeleton, Spinner, StatGrid, StatTile,
  Tabla, claseNumerica, type TonoStat, type ValorRango,
} from '../components/ui'
import { rangoUltimosDias } from '../lib/fechas'
import { ETIQUETAS_CATEGORIA } from '../schemas/etiquetas'
import { CATEGORIAS } from '../schemas/incidencia'
import type { FiltrosAnalitica, ResumenAnalitica } from '../schemas/analitica'

const KPIS: { clave: keyof ResumenAnalitica; etiqueta: string; icono: ReactNode; tono: TonoStat; pista: string }[] = [
  { clave: 'abiertas', etiqueta: 'Abiertas', icono: <FolderOpen />, tono: 'brand', pista: 'Esperan atención' },
  { clave: 'en_proceso', etiqueta: 'En proceso', icono: <Clock />, tono: 'warning', pista: 'En seguimiento' },
  { clave: 'criticas', etiqueta: 'Críticas', icono: <Siren />, tono: 'danger', pista: 'Prioridad crítica' },
  { clave: 'resueltas_periodo', etiqueta: 'Resueltas', icono: <CheckCircle2 />, tono: 'success', pista: 'En el periodo' },
]

const OPCIONES_CATEGORIA = CATEGORIAS.map((clave) => ({ valor: clave, texto: ETIQUETAS_CATEGORIA[clave] }))
const numero = new Intl.NumberFormat('es-MX')
const rangoInicial = () => rangoUltimosDias(30)

function textoAlcance(alcance?: string) {
  if (alcance === 'area') return 'Los resultados se limitan a tu área asignada.'
  if (alcance === 'edificio') return 'Los resultados se limitan a tus edificios asignados.'
  if (alcance === 'propio') return 'Los resultados se limitan a tus incidencias.'
  return 'Indicadores y tendencias de las incidencias del campus.'
}

/** Carga / error / vacío / datos de una sección con estados compactos. */
function Estado<T>({ consulta, etiqueta, vacio, children }: {
  consulta: UseQueryResult<T[]>
  etiqueta: string
  vacio: { titulo: string; descripcion: string }
  children: (datos: T[]) => ReactNode
}) {
  if (consulta.isPending) return <div role="status" aria-label={etiqueta}><Skeleton alto={220} /></div>
  if (consulta.isError) {
    return <ErrorState compacto mensaje={mensajeDeError(consulta.error)} onReintentar={() => { void consulta.refetch() }} reintentando={consulta.isFetching} />
  }
  if (consulta.data.length === 0) return <EmptyState compacto titulo={vacio.titulo} descripcion={vacio.descripcion} />
  return <>{children(consulta.data)}</>
}

export default function Dashboard() {
  const usuario = useAuth((s) => s.usuario)
  const [rango, setRango] = useState<ValorRango>(rangoInicial)
  const [categoria, setCategoria] = useState('')
  // Cambia al limpiar para que RangoFechas vuelva a su atajo inicial.
  const [versionRango, setVersionRango] = useState(0)
  const fechasInvertidas = Boolean(rango.desde && rango.hasta && rango.desde > rango.hasta)
  // Los filtros se aplican al momento; un rango inválido conserva el último válido.
  const [filtros, setFiltros] = useState<FiltrosAnalitica>(() => ({ ...rangoInicial() }))

  function aplicar(siguiente: ValorRango, cat: string) {
    if (siguiente.desde && siguiente.hasta && siguiente.desde > siguiente.hasta) return
    setFiltros({
      ...(siguiente.desde ? { desde: siguiente.desde } : {}),
      ...(siguiente.hasta ? { hasta: siguiente.hasta } : {}),
      ...(cat ? { categoria: cat as FiltrosAnalitica['categoria'] } : {}),
    })
  }

  function cambiarRango(siguiente: ValorRango) {
    setRango(siguiente)
    aplicar(siguiente, categoria)
  }

  function cambiarCategoria(cat: string) {
    setCategoria(cat)
    aplicar(rango, cat)
  }

  function restablecer(dias = 30) {
    const r = rangoUltimosDias(dias)
    setRango(r)
    setCategoria('')
    setVersionRango((v) => v + 1)
    aplicar(r, '')
  }

  const resumen = useQuery({ ...analiticaResumenQuery(filtros), placeholderData: keepPreviousData })
  const edificios = useQuery({ ...analiticaEdificiosQuery(filtros), placeholderData: keepPreviousData })
  const tags = useQuery({ ...analiticaTagsQuery(filtros), placeholderData: keepPreviousData })
  const tendencia = useQuery({ ...analiticaTendenciaQuery(filtros), placeholderData: keepPreviousData })
  const aulas = useQuery({ ...analiticaAulasCronicasQuery(filtros), placeholderData: keepPreviousData })
  // keepPreviousData: al filtrar se conservan los datos anteriores (atenuados) mientras llega la consulta nueva.
  const consultas = [resumen, edificios, tags, tendencia, aulas]

  const actualizando = consultas.some((c) => c.isPlaceholderData || (c.isFetching && !c.isPending))
  const filtrando = consultas.some((c) => c.isPlaceholderData)
  const sinResultados = consultas.every((c) => c.isSuccess && !c.isPlaceholderData) &&
    Object.values(resumen.data ?? {}).every((valor) => valor === 0) &&
    [edificios, tags, tendencia, aulas].every((c) => c.data?.length === 0)
  const activos = (categoria ? 1 : 0) + (rango.desde !== rangoInicial().desde || rango.hasta !== rangoInicial().hasta ? 1 : 0)

  return (
    <div className="pila">
      <PageHeader
        titulo="Panel de analítica"
        subtitulo={textoAlcance(usuario?.alcance)}
        acciones={(
          <Button
            variante="secundario" tamano="sm" icono={<RefreshCw size={16} aria-hidden />}
            cargando={actualizando && !filtrando} textoCargando="Actualizando…"
            onClick={() => { consultas.forEach((c) => { void c.refetch() }) }}
          >Actualizar</Button>
        )}
      />

      <BarraFiltros
        etiqueta="Filtros del panel"
        activos={activos}
        acciones={(
          <>
            <span role="status" className="flex items-center gap-2 text-sm text-muted">
              {actualizando && <><Spinner tamano={16} etiqueta={null} /> Actualizando…</>}
            </span>
            <Button tamano="sm" variante="fantasma" onClick={() => restablecer()}>Limpiar</Button>
          </>
        )}
      >
        <RangoFechas key={versionRango} valor={rango} onCambio={cambiarRango} />
        <Select
          etiqueta="Categoría" tamano="sm" value={categoria} placeholder="Todas"
          opciones={OPCIONES_CATEGORIA} onChange={(e) => cambiarCategoria(e.target.value)}
        />
      </BarraFiltros>
      {fechasInvertidas && <p role="alert" className="campo-error m-0">Desde debe ser igual o anterior a Hasta</p>}

      <div
        className="pila transition-opacity duration-200"
        style={{ opacity: filtrando ? 0.55 : 1 }}
        aria-busy={actualizando}
      >
        {resumen.isError ? (
          <ErrorState compacto mensaje={mensajeDeError(resumen.error)} onReintentar={() => { void resumen.refetch() }} reintentando={resumen.isFetching} />
        ) : (
          <StatGrid columnas={4} etiqueta="Indicadores principales">
            {KPIS.map((kpi) => (
              <StatTile
                key={kpi.clave} etiqueta={kpi.etiqueta} icono={kpi.icono} tono={kpi.tono} pista={kpi.pista}
                cargando={resumen.isPending} valor={resumen.data ? numero.format(resumen.data[kpi.clave]) : ''}
              />
            ))}
          </StatGrid>
        )}

        {sinResultados ? (
          <EmptyState
            compacto icono={SearchX}
            titulo="Sin resultados para los filtros seleccionados"
            descripcion="No hay incidencias en este periodo o categoría."
            accion={<Button tamano="sm" variante="secundario" onClick={() => restablecer(90)}>Ver últimos 90 días</Button>}
          />
        ) : (
          <>
            <div className="grid items-start gap-4 xl:grid-cols-3">
              <Seccion titulo="Tendencia mensual" descripcion="Incidencias creadas por mes y categoría." className="xl:col-span-2">
                <Estado consulta={tendencia} etiqueta="Cargando tendencia" vacio={{ titulo: 'Sin tendencia', descripcion: 'No se crearon incidencias en el periodo.' }}>
                  {(datos) => <TendenciaCategorias datos={datos} />}
                </Estado>
              </Seccion>
              <Seccion titulo="Aulas crónicas" descripcion="3 o más incidencias en los últimos 30 días." sinPadding>
                <Estado consulta={aulas} etiqueta="Cargando aulas crónicas" vacio={{ titulo: 'Sin aulas crónicas', descripcion: 'Ninguna aula acumula incidencias repetidas.' }}>
                  {(datos) => (
                    <Tabla etiqueta="Aulas con incidencias recurrentes" densa altoMax={320}>
                      <thead><tr><th scope="col">Aula</th><th scope="col">Edificio</th><th scope="col" className={claseNumerica}>Incidencias</th></tr></thead>
                      <tbody>
                        {[...datos].sort((a, b) => b.total - a.total).slice(0, 10).map((a) => (
                          <tr key={`${a.edificio}-${a.piso ?? ''}-${a.aula}`}>
                            <th scope="row">{a.aula}</th>
                            <td>{a.edificio}{a.piso !== undefined ? ` · piso ${a.piso}` : ''}</td>
                            <td className={claseNumerica}>{numero.format(a.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </Tabla>
                  )}
                </Estado>
              </Seccion>
            </div>

            <div className="grid items-start gap-4 xl:grid-cols-2">
              <Seccion titulo="Horas por edificio" descripcion="Incidencias resueltas, por fecha de resolución.">
                <Estado consulta={edificios} etiqueta="Cargando horas por edificio" vacio={{ titulo: 'Sin datos por edificio', descripcion: 'No hay incidencias resueltas en el periodo.' }}>
                  {(datos) => <HorasEdificio datos={datos} />}
                </Estado>
              </Seccion>
              <Seccion titulo="Diez etiquetas más frecuentes" descripcion="Por fecha de creación.">
                <Estado consulta={tags} etiqueta="Cargando etiquetas" vacio={{ titulo: 'Sin etiquetas', descripcion: 'No hay etiquetas registradas en el periodo.' }}>
                  {(datos) => <TopTags datos={datos} />}
                </Estado>
              </Seccion>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
