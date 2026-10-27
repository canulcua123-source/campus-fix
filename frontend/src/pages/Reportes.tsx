import { useState, type FormEvent, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Download, Printer } from 'lucide-react'
import { useAnalitica, useAnaliticaTendencia, useAulasCronicas } from '../api/hooks/analitica'
import { incidenciasQuery } from '../api/incidencias'
import { mensajeDeError } from '../api/client'
import { Button, Card, EmptyState, ErrorState, Input, PageHeader, Skeleton } from '../components/ui'
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

function Tabla({ titulo, columnas, children }: { titulo: string; columnas: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{titulo}</caption>
        <thead>
          <tr>{columnas.map((c) => <th key={c} scope="col" className="p-2 text-muted">{c}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

const fila = 'border-t border-line'

function Seccion({ id, titulo, descripcion, children }: { id: string; titulo: string; descripcion: string; children: ReactNode }) {
  return (
    <Card como="section" aria-labelledby={id} className="reporte-seccion flex flex-col gap-3">
      <h2 id={id} className="text-lg font-semibold">{titulo}</h2>
      <p className="text-sm text-muted">{descripcion}</p>
      {children}
    </Card>
  )
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
  const [borrador, setBorrador] = useState({ desde: '', hasta: '' })
  const [filtros, setFiltros] = useState<FiltrosAnalitica>({})
  const [generando, setGenerando] = useState(false)
  const [aviso, setAviso] = useState<Aviso>(null)
  const [generado, setGenerado] = useState(ahora)
  const { resumen, edificios, tags } = useAnalitica(filtros)
  const tendencia = useAnaliticaTendencia(filtros)
  const aulas = useAulasCronicas(filtros)
  const fechasInvertidas = Boolean(borrador.desde && borrador.hasta && borrador.desde > borrador.hasta)

  function aplicar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (fechasInvertidas) return
    setAviso(null)
    setGenerado(ahora())
    setFiltros({
      ...(borrador.desde ? { desde: borrador.desde } : {}),
      ...(borrador.hasta ? { hasta: borrador.hasta } : {}),
    })
  }

  function limpiar() {
    setBorrador({ desde: '', hasta: '' })
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
    <div className="flex flex-col gap-5">
      <div className="solo-pantalla">
        <PageHeader
          titulo="Reportes"
          subtitulo="Resumen ejecutivo imprimible y exportación de incidencias"
          acciones={(
            <>
              <Button
                variante="secundario" icono={<Download size={18} />} cargando={generando} textoCargando="Generando CSV…"
                onClick={() => { void descargarCsv() }}
              >Descargar CSV</Button>
              <Button variante="secundario" icono={<Printer size={18} />} onClick={() => window.print()}>Imprimir / PDF</Button>
            </>
          )}
        />
      </div>

      {aviso && (
        <p role={aviso.tipo} className={`solo-pantalla text-sm ${aviso.tipo === 'alert' ? 'text-bad' : 'text-muted'}`}>{aviso.texto}</p>
      )}

      <Card como="section" aria-label="Periodo del reporte" className="solo-pantalla flex flex-col gap-3">
        <h2 className="text-base font-semibold">Periodo</h2>
        <form onSubmit={aplicar} className="grid gap-3 md:grid-cols-3 md:items-end">
          <Input
            etiqueta="Desde" type="date" value={borrador.desde} max={borrador.hasta || undefined}
            onChange={(e) => setBorrador((prev) => ({ ...prev, desde: e.target.value }))}
            error={fechasInvertidas ? 'Desde debe ser igual o anterior a Hasta' : undefined}
          />
          <Input
            etiqueta="Hasta" type="date" value={borrador.hasta} min={borrador.desde || undefined}
            onChange={(e) => setBorrador((prev) => ({ ...prev, hasta: e.target.value }))}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={fechasInvertidas}>Aplicar periodo</Button>
            <Button variante="secundario" onClick={limpiar}>Limpiar</Button>
          </div>
        </form>
        <p className="text-xs text-muted">
          El periodo usa fechas UTC. El CSV incluye las incidencias creadas en el periodo.
        </p>
      </Card>

      <div className="reporte-imprimible flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h2 className="text-xl font-bold">Resumen ejecutivo de incidencias</h2>
          <p className="text-sm text-muted">{textoPeriodo(filtros)} · Generado el {generado}</p>
        </header>

        <Seccion id="reporte-kpis" titulo="Indicadores principales" descripcion="Estado actual de las incidencias dentro de tu alcance.">
          {resumen.isPending ? <Cargando etiqueta="Cargando indicadores" />
            : resumen.isError ? (
              <ErrorState mensaje={mensajeDeError(resumen.error)} onReintentar={() => { void resumen.refetch() }} reintentando={resumen.isFetching} />
            ) : (
              <Tabla titulo="Indicadores principales" columnas={['Indicador', 'Incidencias']}>
                {KPIS.map((k) => (
                  <tr key={k.clave} className={fila}>
                    <th scope="row" className="p-2">{k.etiqueta}</th>
                    <td className="p-2">{numero.format(resumen.data[k.clave])}</td>
                  </tr>
                ))}
              </Tabla>
            )}
        </Seccion>

        <Seccion id="reporte-edificios" titulo="Edificios con más incidencias resueltas" descripcion="Por fecha de resolución; hasta diez edificios.">
          {edificios.isPending ? <Cargando etiqueta="Cargando edificios" />
            : edificios.isError ? (
              <ErrorState mensaje={mensajeDeError(edificios.error)} onReintentar={() => { void edificios.refetch() }} reintentando={edificios.isFetching} />
            ) : topEdificios.length === 0 ? (
              <EmptyState titulo="Sin datos por edificio" descripcion="No hay incidencias resueltas en el periodo." />
            ) : (
              <Tabla titulo="Edificios con más incidencias resueltas" columnas={['Edificio', 'Resueltas', 'Horas invertidas', 'Promedio de resolución']}>
                {topEdificios.map((e) => (
                  <tr key={e.edificio} className={fila}>
                    <th scope="row" className="p-2">{e.edificio}</th>
                    <td className="p-2">{numero.format(e.total)}</td>
                    <td className="p-2">{formatearHoras(e.horas_invertidas)}</td>
                    <td className="p-2">{e.horas_resolucion_prom === null ? 'Sin dato' : formatearHoras(e.horas_resolucion_prom)}</td>
                  </tr>
                ))}
              </Tabla>
            )}
        </Seccion>

        <Seccion id="reporte-tags" titulo="Etiquetas más frecuentes" descripcion="Por fecha de creación; hasta diez etiquetas.">
          {tags.isPending ? <Cargando etiqueta="Cargando etiquetas" />
            : tags.isError ? (
              <ErrorState mensaje={mensajeDeError(tags.error)} onReintentar={() => { void tags.refetch() }} reintentando={tags.isFetching} />
            ) : tags.data.length === 0 ? (
              <EmptyState titulo="Sin etiquetas" descripcion="No hay etiquetas registradas en el periodo." />
            ) : (
              <Tabla titulo="Etiquetas más frecuentes" columnas={['Posición', 'Etiqueta', 'Incidencias']}>
                {tags.data.map((t, posicion) => (
                  <tr key={t.tag} className={fila}>
                    <td className="p-2">{posicion + 1}</td>
                    <th scope="row" className="p-2">{t.tag}</th>
                    <td className="p-2">{numero.format(t.total)}</td>
                  </tr>
                ))}
              </Tabla>
            )}
        </Seccion>

        <Seccion id="reporte-tendencia" titulo="Tendencia mensual" descripcion="Incidencias creadas por mes (UTC) y categoría.">
          {tendencia.isPending ? <Cargando etiqueta="Cargando tendencia" />
            : tendencia.isError ? (
              <ErrorState mensaje={mensajeDeError(tendencia.error)} onReintentar={() => { void tendencia.refetch() }} reintentando={tendencia.isFetching} />
            ) : periodosTendencia.length === 0 ? (
              <EmptyState titulo="Sin tendencia" descripcion="No hay incidencias creadas en el periodo." />
            ) : (
              <Tabla titulo="Tendencia mensual" columnas={['Mes', ...CATEGORIAS.map((c) => ETIQUETAS_CATEGORIA[c]), 'Total']}>
                {periodosTendencia.map((p) => (
                  <tr key={p} className={fila}>
                    <th scope="row" className="p-2">{mes(p)}</th>
                    {CATEGORIAS.map((c) => <td key={c} className="p-2">{numero.format(totalTendencia(p, c))}</td>)}
                    <td className="p-2 font-semibold">
                      {numero.format(CATEGORIAS.reduce((suma, c) => suma + totalTendencia(p, c), 0))}
                    </td>
                  </tr>
                ))}
              </Tabla>
            )}
        </Seccion>

        <Seccion id="reporte-aulas" titulo="Aulas crónicas" descripcion="Aulas con tres o más incidencias en los últimos 30 días, dentro del periodo.">
          {aulas.isPending ? <Cargando etiqueta="Cargando aulas crónicas" />
            : aulas.isError ? (
              <ErrorState mensaje={mensajeDeError(aulas.error)} onReintentar={() => { void aulas.refetch() }} reintentando={aulas.isFetching} />
            ) : aulas.data.length === 0 ? (
              <EmptyState titulo="Sin aulas crónicas" descripcion="Ninguna aula acumula tres o más incidencias recientes." />
            ) : (
              <Tabla titulo="Aulas crónicas" columnas={['Edificio', 'Piso', 'Aula', 'Incidencias']}>
                {aulas.data.map((a) => (
                  <tr key={`${a.edificio}-${a.piso ?? ''}-${a.aula}`} className={fila}>
                    <td className="p-2">{a.edificio}</td>
                    <td className="p-2">{a.piso ?? 'Sin piso'}</td>
                    <th scope="row" className="p-2">{a.aula}</th>
                    <td className="p-2">{numero.format(a.total)}</td>
                  </tr>
                ))}
              </Tabla>
            )}
        </Seccion>
      </div>
    </div>
  )
}
