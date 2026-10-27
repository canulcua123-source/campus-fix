import { useState, type ReactNode } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Printer } from 'lucide-react'
import {
  analiticaAulasCronicasQuery, analiticaEdificiosQuery, analiticaResumenQuery, analiticaTagsQuery, analiticaTendenciaQuery,
} from '../api/analitica'
import { incidenciasQuery } from '../api/incidencias'
import { mensajeDeError } from '../api/client'
import {
  BarraFiltros, Button, EmptyState, ErrorState, PageHeader, RangoFechas, Seccion as SeccionUi, Skeleton, Spinner, Tabla as TablaUi,
  claseNumerica, type ValorRango,
} from '../components/ui'
import { enPeriodo, incidenciasACsv, intervaloUtc } from '../lib/csv'
import { formatearFecha, formatearHoras } from '../lib/detalle'
import { ETIQUETAS_CATEGORIA } from '../schemas/etiquetas'
import { CATEGORIAS, ESTADOS, type IncidenciaListaItem } from '../schemas/incidencia'
import type { FiltrosAnalitica, ResumenAnalitica, TendenciaMensual } from '../schemas/analitica'

/** GET /incidencias no pagina: máximo 100 por consulta. Se consulta una vez por estado (tope 600). */
const LIMITE_POR_CONSULTA = 100
const TOPE_FILAS = LIMITE_POR_CONSULTA * ESTADOS.length

const KPIS: { clave: keyof ResumenAnalitica; etiqueta: string }[] = [
  { clave: 'abiertas', etiqueta: 'Abiertas' },
  { clave: 'en_proceso', etiqueta: 'En proceso' },
  { clave: 'criticas', etiqueta: 'Críticas' },
  { clave: 'resueltas_periodo', etiqueta: 'Resueltas en el periodo' },
]

const numero = new Intl.NumberFormat('es-MX')
// Periodos y días calendario vienen del backend en UTC: se formatean en UTC para no recorrer el día/mes.
const formatoMes = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const formatoDia = new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeZone: 'UTC' })

const mes = (periodo: string) => {
  const [anio, m] = periodo.split('-').map(Number)
  return formatoMes.format(new Date(Date.UTC(anio, m - 1, 1)))
}
const dia = (iso: string) => formatoDia.format(new Date(`${iso}T00:00:00Z`))

function textoPeriodo({ desde, hasta }: FiltrosAnalitica): string {
  if (desde && hasta) return `Del ${dia(desde)} al ${dia(hasta)}`
  if (desde) return `Desde el ${dia(desde)}`
  if (hasta) return `Hasta el ${dia(hasta)}`
  return 'Todo el historial disponible'
}

const ahora = () => formatearFecha(new Date().toISOString())

type Aviso = { tipo: 'status' | 'alert'; texto: string } | null

function descargar(contenido: string, nombre: string) {
  const url = URL.createObjectURL(new Blob([contenido], { type: 'text/csv;charset=utf-8' }))
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombre
  document.body.appendChild(enlace)
  enlace.click()
  enlace.remove()
  URL.revokeObjectURL(url)
}

/** Columnas: texto o { texto, numerica } para alinear cifras a la derecha. */
function Tabla({ titulo, columnas, children }: { titulo: string; columnas: (string | { texto: string; numerica: true })[]; children: ReactNode }) {
  return (
    <TablaUi etiqueta={titulo} densa>
      <thead>
        <tr>{columnas.map((c) => typeof c === 'string'
          ? <th key={c} scope="col">{c}</th>
          : <th key={c.texto} scope="col" className={claseNumerica}>{c.texto}</th>)}</tr>
      </thead>
      <tbody>{children}</tbody>
    </TablaUi>
  )
}

const num = (texto: string) => ({ texto, numerica: true as const })

function Seccion({ titulo, descripcion, children }: { titulo: string; descripcion: string; children: ReactNode }) {
  return <SeccionUi titulo={titulo} descripcion={descripcion} className="reporte-seccion">{children}</SeccionUi>
}

function Cargando({ etiqueta }: { etiqueta: string }) {
  return (
    <div role="status" aria-label={etiqueta} className="flex flex-col gap-2">
      <Skeleton alto={20} /><Skeleton alto={20} /><Skeleton alto={20} ancho="70%" />
    </div>
  )
}

export default function Reportes() {
  const qc = useQueryClient()
  const [rango, setRango] = useState<ValorRango>({})
  const [versionRango, setVersionRango] = useState(0)
  const [filtros, setFiltros] = useState<FiltrosAnalitica>({})
  const [generando, setGenerando] = useState(false)
  const [aviso, setAviso] = useState<Aviso>(null)
  const [generado, setGenerado] = useState(ahora)
  // keepPreviousData: al cambiar el periodo se conserva (atenuado) el reporte anterior hasta que llega el nuevo.
  const resumen = useQuery({ ...analiticaResumenQuery(filtros), placeholderData: keepPreviousData })
  const edificios = useQuery({ ...analiticaEdificiosQuery(filtros), placeholderData: keepPreviousData })
  const tags = useQuery({ ...analiticaTagsQuery(filtros), placeholderData: keepPreviousData })
  const tendencia = useQuery({ ...analiticaTendenciaQuery(filtros), placeholderData: keepPreviousData })
  const aulas = useQuery({ ...analiticaAulasCronicasQuery(filtros), placeholderData: keepPreviousData })
  const filtrando = [resumen, edificios, tags, tendencia, aulas].some((c) => c.isPlaceholderData)
  const fechasInvertidas = Boolean(rango.desde && rango.hasta && rango.desde > rango.hasta)

  /** El periodo se aplica al momento; un rango invertido no se envía. */
  function cambiarRango(siguiente: ValorRango) {
    setRango(siguiente)
    if (siguiente.desde && siguiente.hasta && siguiente.desde > siguiente.hasta) return
    setAviso(null)
    setGenerado(ahora())
    setFiltros({
      ...(siguiente.desde ? { desde: siguiente.desde } : {}),
      ...(siguiente.hasta ? { hasta: siguiente.hasta } : {}),
    })
  }

  function limpiar() {
    setRango({})
    setVersionRango((v) => v + 1)
    setFiltros({})
    setAviso(null)
    setGenerado(ahora())
  }

  async function descargarCsv() {
    setGenerando(true)
    setAviso(null)
    try {
      const intervalo = intervaloUtc(filtros.desde, filtros.hasta)
      const listas = await Promise.all(ESTADOS.map((estado) =>
        qc.fetchQuery({ ...incidenciasQuery({ estado, limite: LIMITE_POR_CONSULTA }), staleTime: 0 })))
      // Lista ordenada por fecha desc: si llegó llena y su elemento más antiguo sigue dentro del periodo, puede haber más.
      const truncado = listas.some((l) =>
        l.length >= LIMITE_POR_CONSULTA && Date.parse(l[l.length - 1].fecha_creacion) >= intervalo.inicio)
      const vistas = new Map<string, IncidenciaListaItem>()
      for (const i of listas.flat()) if (enPeriodo(i.fecha_creacion, intervalo)) vistas.set(i._id, i)
      const filas = [...vistas.values()].sort((a, b) => Date.parse(b.fecha_creacion) - Date.parse(a.fecha_creacion))
      if (filas.length === 0) {
        setAviso({ tipo: 'status', texto: 'No hay incidencias en el periodo seleccionado; no se generó el archivo.' })
        return
      }
      descargar(incidenciasACsv(filas), `reporte-incidencias-${filtros.desde ?? 'inicio'}-a-${filtros.hasta ?? 'hoy'}.csv`)
      const base = `Se descargó el CSV con ${numero.format(filas.length)} incidencias.`
      setAviso({
        tipo: 'status',
        texto: truncado
          ? `${base} El archivo está incompleto: se consultan como máximo ${LIMITE_POR_CONSULTA} incidencias recientes por estado (${TOPE_FILAS} en total). Reduce el periodo para obtener todas.`
          : base,
      })
    } catch (e) {
      setAviso({ tipo: 'alert', texto: mensajeDeError(e, 'No se pudo generar el CSV. Intenta de nuevo.') })
    } finally {
      setGenerando(false)
    }
  }

  const topEdificios = edificios.data ? [...edificios.data].sort((a, b) => b.total - a.total).slice(0, 10) : []
  const periodosTendencia = tendencia.data ? [...new Set(tendencia.data.map((t) => t.periodo))].sort() : []
  const totalTendencia = (periodo: string, categoria: TendenciaMensual['categoria']) =>
    tendencia.data?.find((t) => t.periodo === periodo && t.categoria === categoria)?.total ?? 0

  return (
    <div className="pila">
      <div className="solo-pantalla">
        <PageHeader
          titulo="Reportes"
          subtitulo="Resumen ejecutivo imprimible y exportación de incidencias."
          acciones={(
            <>
              <Button
                variante="secundario" tamano="sm" icono={<Download size={16} />} cargando={generando} textoCargando="Generando CSV…"
                onClick={() => { void descargarCsv() }}
              >Descargar CSV</Button>
              <Button variante="secundario" tamano="sm" icono={<Printer size={16} />} onClick={() => window.print()}>Imprimir / PDF</Button>
            </>
          )}
        />
      </div>

      <BarraFiltros
        etiqueta="Periodo del reporte"
        activos={filtros.desde || filtros.hasta ? 1 : 0}
        className="solo-pantalla"
        acciones={(
          <>
            <span role="status" className="flex items-center gap-2 text-sm text-muted">
              {filtrando && <><Spinner tamano={16} etiqueta={null} /> Actualizando…</>}
            </span>
            <Button tamano="sm" variante="fantasma" onClick={limpiar}>Limpiar</Button>
          </>
        )}
      >
        <RangoFechas key={versionRango} valor={rango} onCambio={cambiarRango} permitirTodo />
      </BarraFiltros>
      {fechasInvertidas && <p role="alert" className="solo-pantalla campo-error m-0">Desde debe ser igual o anterior a Hasta</p>}

      {aviso && (
        <p role={aviso.tipo} className={`solo-pantalla m-0 text-sm ${aviso.tipo === 'alert' ? 'text-bad' : 'text-muted'}`}>{aviso.texto}</p>
      )}

      <div className="reporte-imprimible pila transition-opacity duration-200" style={{ opacity: filtrando ? 0.55 : 1 }} aria-busy={filtrando}>
        <header className="flex flex-col gap-1">
          <h2 className="m-0 text-lg font-semibold">Resumen ejecutivo de incidencias</h2>
          <p className="m-0 text-sm text-muted">{textoPeriodo(filtros)} · Generado el {generado}</p>
        </header>

        <Seccion titulo="Indicadores principales" descripcion="Estado actual de las incidencias dentro de tu alcance.">
          {resumen.isPending ? <Cargando etiqueta="Cargando indicadores" />
            : resumen.isError ? (
              <ErrorState compacto mensaje={mensajeDeError(resumen.error)} onReintentar={() => { void resumen.refetch() }} reintentando={resumen.isFetching} />
            ) : (
              <Tabla titulo="Indicadores principales" columnas={['Indicador', num('Incidencias')]}>
                {KPIS.map((k) => (
                  <tr key={k.clave}>
                    <th scope="row">{k.etiqueta}</th>
                    <td className={claseNumerica}>{numero.format(resumen.data[k.clave])}</td>
                  </tr>
                ))}
              </Tabla>
            )}
        </Seccion>

        <Seccion titulo="Edificios con más incidencias resueltas" descripcion="Por fecha de resolución; hasta diez edificios.">
          {edificios.isPending ? <Cargando etiqueta="Cargando edificios" />
            : edificios.isError ? (
              <ErrorState compacto mensaje={mensajeDeError(edificios.error)} onReintentar={() => { void edificios.refetch() }} reintentando={edificios.isFetching} />
            ) : topEdificios.length === 0 ? (
              <EmptyState compacto titulo="Sin datos por edificio" descripcion="No hay incidencias resueltas en el periodo." />
            ) : (
              <Tabla titulo="Edificios con más incidencias resueltas" columnas={['Edificio', num('Resueltas'), num('Horas invertidas'), num('Promedio de resolución')]}>
                {topEdificios.map((e) => (
                  <tr key={e.edificio}>
                    <th scope="row">{e.edificio}</th>
                    <td className={claseNumerica}>{numero.format(e.total)}</td>
                    <td className={claseNumerica}>{formatearHoras(e.horas_invertidas)}</td>
                    <td className={claseNumerica}>{e.horas_resolucion_prom === null ? 'Sin dato' : formatearHoras(e.horas_resolucion_prom)}</td>
                  </tr>
                ))}
              </Tabla>
            )}
        </Seccion>

        <Seccion titulo="Etiquetas más frecuentes" descripcion="Por fecha de creación; hasta diez etiquetas.">
          {tags.isPending ? <Cargando etiqueta="Cargando etiquetas" />
            : tags.isError ? (
              <ErrorState compacto mensaje={mensajeDeError(tags.error)} onReintentar={() => { void tags.refetch() }} reintentando={tags.isFetching} />
            ) : tags.data.length === 0 ? (
              <EmptyState compacto titulo="Sin etiquetas" descripcion="No hay etiquetas registradas en el periodo." />
            ) : (
              <Tabla titulo="Etiquetas más frecuentes" columnas={[num('Posición'), 'Etiqueta', num('Incidencias')]}>
                {tags.data.map((t, posicion) => (
                  <tr key={t.tag}>
                    <td className={claseNumerica}>{posicion + 1}</td>
                    <th scope="row">{t.tag}</th>
                    <td className={claseNumerica}>{numero.format(t.total)}</td>
                  </tr>
                ))}
              </Tabla>
            )}
        </Seccion>

        <Seccion titulo="Tendencia mensual" descripcion="Incidencias creadas por mes y categoría.">
          {tendencia.isPending ? <Cargando etiqueta="Cargando tendencia" />
            : tendencia.isError ? (
              <ErrorState compacto mensaje={mensajeDeError(tendencia.error)} onReintentar={() => { void tendencia.refetch() }} reintentando={tendencia.isFetching} />
            ) : periodosTendencia.length === 0 ? (
              <EmptyState compacto titulo="Sin tendencia" descripcion="No hay incidencias creadas en el periodo." />
            ) : (
              <Tabla titulo="Tendencia mensual" columnas={['Mes', ...CATEGORIAS.map((c) => num(ETIQUETAS_CATEGORIA[c])), num('Total')]}>
                {periodosTendencia.map((p) => (
                  <tr key={p}>
                    <th scope="row">{mes(p)}</th>
                    {CATEGORIAS.map((c) => <td key={c} className={claseNumerica}>{numero.format(totalTendencia(p, c))}</td>)}
                    <td className={`${claseNumerica} font-semibold`}>
                      {numero.format(CATEGORIAS.reduce((suma, c) => suma + totalTendencia(p, c), 0))}
                    </td>
                  </tr>
                ))}
              </Tabla>
            )}
        </Seccion>

        <Seccion titulo="Aulas crónicas" descripcion="Aulas con tres o más incidencias en los últimos 30 días, dentro del periodo.">
          {aulas.isPending ? <Cargando etiqueta="Cargando aulas crónicas" />
            : aulas.isError ? (
              <ErrorState compacto mensaje={mensajeDeError(aulas.error)} onReintentar={() => { void aulas.refetch() }} reintentando={aulas.isFetching} />
            ) : aulas.data.length === 0 ? (
              <EmptyState compacto titulo="Sin aulas crónicas" descripcion="Ninguna aula acumula tres o más incidencias recientes." />
            ) : (
              <Tabla titulo="Aulas crónicas" columnas={['Edificio', 'Piso', 'Aula', num('Incidencias')]}>
                {aulas.data.map((a) => (
                  <tr key={`${a.edificio}-${a.piso ?? ''}-${a.aula}`}>
                    <td>{a.edificio}</td>
                    <td>{a.piso ?? 'Sin piso'}</td>
                    <th scope="row">{a.aula}</th>
                    <td className={claseNumerica}>{numero.format(a.total)}</td>
                  </tr>
                ))}
              </Tabla>
            )}
        </Seccion>
      </div>
    </div>
  )
}
