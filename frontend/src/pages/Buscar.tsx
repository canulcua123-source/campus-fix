import clsx from 'clsx'
import { Clock, MapPin, Search, SearchX } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useBuscar } from '../api/hooks/incidencias'
import { haceCuanto } from '../lib/tiempo'
import { busquedaSchema, ESTADOS, type Estado } from '../schemas/incidencia'
import { Badge, Card, EmptyState, ErrorState, ETIQUETAS, PageHeader, SkeletonLista } from '../components/ui'

/** Minúsculas y sin acentos, conservando la longitud (un carácter por carácter) para poder cortar el texto original. */
function plegar(texto: string): string {
  return texto.split('').map((c) => c.normalize('NFD').charAt(0).toLowerCase().charAt(0)).join('')
}

/** Resalta palabras completas que empiezan con algún término buscado (sin distinguir acentos ni mayúsculas). */
function TextoResaltado({ texto, termino }: { texto: string; termino: string }) {
  const terminos = plegar(termino).split(/\s+/).filter((t) => t.length >= 2)
  if (terminos.length === 0) return <>{texto}</>
  const partes: ReactNode[] = []
  let desde = 0
  for (const palabra of texto.matchAll(/[\p{L}\p{N}]+/gu)) {
    const inicio = palabra.index ?? 0
    const plegada = plegar(palabra[0])
    if (!terminos.some((t) => plegada.startsWith(t))) continue
    if (inicio > desde) partes.push(texto.slice(desde, inicio))
    partes.push(<mark key={inicio} className="rounded bg-warn px-0.5 text-on-warn">{palabra[0]}</mark>)
    desde = inicio + palabra[0].length
  }
  if (desde < texto.length) partes.push(texto.slice(desde))
  return <>{partes}</>
}

/** El backend devuelve como máximo este número de resultados. */
const MAX_RESULTADOS = 20

function Puntaje({ score }: { score?: number }) {
  if (score === undefined) return null
  return <span className="text-xs text-muted">Relevancia: {score.toLocaleString('es-MX', { maximumFractionDigits: 2 })}</span>
}

/** Chip de filtro (botón con aria-pressed), 44 px táctil. */
function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      onClick={onClick}
      className={clsx(
        'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors active:scale-[0.97] md:min-h-9',
        activo ? 'border-brand bg-brand font-semibold text-on-brand' : 'border-line bg-panel text-ink hover:border-line-strong',
      )}
    >
      {children}
    </button>
  )
}

/** Sugerencias cuando no hay resultados: buscar cada palabra por separado. */
function sugerencias(termino: string): string[] {
  const palabras = termino.split(/\s+/).filter((p) => p.length >= 2)
  return palabras.length > 1 ? palabras.slice(0, 4) : []
}

export default function Buscar() {
  const [parametros] = useSearchParams()
  const termino = parametros.get('q')?.trim() ?? ''
  const consultaValida = busquedaSchema.safeParse(termino).success
  const { data, isPending, isError, isFetching, refetch } = useBuscar(termino)
  // El filtro de estado se reinicia al cambiar de término.
  const [filtro, setFiltro] = useState<{ termino: string; estado: Estado | null }>({ termino, estado: null })
  const estado = filtro.termino === termino ? filtro.estado : null

  if (!consultaValida) {
    return (
      <EmptyState
        titulo="Busca incidencias"
        descripcion="Escribe al menos dos caracteres en la barra de búsqueda para encontrar reportes por palabras clave."
        icono={Search}
      />
    )
  }

  const encabezado = <PageHeader titulo={`Resultados para “${termino}”`} />

  if (isPending) {
    return (
      <div className="pila">
        {encabezado}
        <SkeletonLista etiqueta="Buscando incidencias" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="pila">
        {encabezado}
        <ErrorState
          titulo="No pudimos realizar la búsqueda"
          mensaje="Revisa tu conexión e intenta de nuevo."
          onReintentar={() => void refetch()}
          reintentando={isFetching}
        />
      </div>
    )
  }

  if (!data?.length) {
    const otras = sugerencias(termino)
    return (
      <div className="pila">
        {encabezado}
        <EmptyState
          compacto
          nivel={2}
          titulo="Sin resultados"
          descripcion={`No encontramos incidencias con “${termino}”. Prueba con otras palabras o un término más general.`}
          icono={SearchX}
          accion={otras.length > 0 ? (
            <div className="flex flex-wrap justify-center gap-2">
              {otras.map((p) => (
                <Link key={p} to={`/buscar?q=${encodeURIComponent(p)}`} className="ui-btn ui-btn--secundario ui-btn--sm">
                  Buscar “{p}”
                </Link>
              ))}
            </div>
          ) : undefined}
        />
      </div>
    )
  }

  const presentes = ESTADOS.filter((e) => data.some((i) => i.estado === e))
  const visibles = estado ? data.filter((i) => i.estado === estado) : data

  return (
    <div className="pila">
      {encabezado}
      <div className="flex flex-col gap-2">
        <p className="m-0 text-sm text-muted">{data.length} resultado{data.length === 1 ? '' : 's'}, ordenados por relevancia.</p>
        {data.length >= MAX_RESULTADOS && (
          <p className="m-0 text-sm text-muted" role="note">
            Mostrando los {MAX_RESULTADOS} resultados más relevantes. Afina tu búsqueda para ver otros.
          </p>
        )}
        {presentes.length > 1 && (
          <div role="group" aria-label="Filtrar por estado" className="flex flex-wrap gap-2">
            <Chip activo={estado === null} onClick={() => setFiltro({ termino, estado: null })}>Todos · {data.length}</Chip>
            {presentes.map((e) => (
              <Chip key={e} activo={estado === e} onClick={() => setFiltro({ termino, estado: e })}>
                {ETIQUETAS.estado[e]} · {data.filter((i) => i.estado === e).length}
              </Chip>
            ))}
          </div>
        )}
      </div>
      <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Resultados">
        {visibles.map((incidencia) => (
          <li key={incidencia._id}>
            <Card
              className="relative flex flex-col gap-2 transition-colors hover:border-line-strong focus-within:border-line-strong"
              style={{ borderLeft: `4px solid var(--prioridad-${incidencia.prioridad}, var(--color-border))` }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                <span className="tabular-nums">{incidencia.codigo}</span>
                <Puntaje score={incidencia.score} />
              </div>
              <h2 className="m-0 text-base font-semibold leading-snug">
                <Link
                  to={`/incidencias/${incidencia._id}`}
                  className="text-ink no-underline after:absolute after:inset-0 after:rounded-card after:content-['']"
                >
                  <TextoResaltado texto={incidencia.titulo} termino={termino} />
                </Link>
              </h2>
              <div className="flex flex-wrap gap-1.5">
                <Badge tipo="estado" valor={incidencia.estado} />
                <Badge tipo="prioridad" valor={incidencia.prioridad} />
                <Badge tipo="categoria" valor={incidencia.categoria} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm text-muted">
                <span className="inline-flex min-w-0 items-center gap-1">
                  <MapPin size={14} aria-hidden className="shrink-0" />
                  <TextoResaltado texto={`${incidencia.ubicacion.edificio} · ${incidencia.ubicacion.aula}`} termino={termino} />
                </span>
                <span className="inline-flex items-center gap-1 text-xs">
                  <Clock size={12} aria-hidden />{haceCuanto(incidencia.fecha_creacion)}
                </span>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  )
}
