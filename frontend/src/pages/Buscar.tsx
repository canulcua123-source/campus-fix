import { Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useBuscar } from '../api/hooks/incidencias'
import { busquedaSchema } from '../schemas/incidencia'
import { Badge, Card, EmptyState, ErrorState, Skeleton } from '../components/ui'

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

export default function Buscar() {
  const [parametros] = useSearchParams()
  const termino = parametros.get('q')?.trim() ?? ''
  const consultaValida = busquedaSchema.safeParse(termino).success
  const { data, isPending, isError, isFetching, refetch } = useBuscar(termino)

  if (!consultaValida) {
    return (
      <EmptyState
        titulo="Busca incidencias"
        descripcion="Escribe al menos dos caracteres en la barra de búsqueda para encontrar reportes por palabras clave."
        icono={Search}
      />
    )
  }

  if (isPending) {
    return (
      <>
        <h1 className="titulo-pagina">Resultados para “{termino}”</h1>
        <div role="status" aria-label="Buscando incidencias" className="flex flex-col gap-3">
          {[1, 2, 3].map((indice) => <Card key={indice}><Skeleton ancho="70%" alto={18} /><Skeleton ancho="45%" alto={12} /></Card>)}
        </div>
      </>
    )
  }

  if (isError) {
    return (
      <>
        <h1 className="titulo-pagina">Resultados para “{termino}”</h1>
        <ErrorState
          titulo="No pudimos realizar la búsqueda"
          mensaje="Revisa tu conexión e intenta de nuevo."
          onReintentar={() => void refetch()}
          reintentando={isFetching}
        />
      </>
    )
  }

  if (!data?.length) {
    return (
      <EmptyState
        titulo="Sin resultados"
        descripcion={`No encontramos incidencias con “${termino}”. Prueba con otras palabras o un término más general.`}
        icono={Search}
      />
    )
  }

  return (
    <>
      <h1 className="titulo-pagina">Resultados para “{termino}”</h1>
      <p className="mt-0 text-sm text-muted">{data.length} resultado{data.length === 1 ? '' : 's'}, ordenados por relevancia.</p>
      {data.length >= MAX_RESULTADOS && (
        <p className="mt-0 text-sm text-muted" role="note">
          Mostrando los {MAX_RESULTADOS} resultados más relevantes. Afina tu búsqueda para ver otros.
        </p>
      )}
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {data.map((incidencia) => (
          <li key={incidencia._id}>
            <Link to={`/incidencias/${incidencia._id}`} className="block no-underline">
              <Card className="text-ink">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted">{incidencia.codigo}</span>
                  <Puntaje score={incidencia.score} />
                </div>
                <h2 className="my-1 text-base font-semibold"><TextoResaltado texto={incidencia.titulo} termino={termino} /></h2>
                <p className="m-0 text-sm text-muted"><TextoResaltado texto={`${incidencia.ubicacion.edificio} · ${incidencia.ubicacion.aula}`} termino={termino} /></p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge tipo="prioridad" valor={incidencia.prioridad} />
                  <Badge tipo="estado" valor={incidencia.estado} />
                  <Badge tipo="categoria" valor={incidencia.categoria} />
                </div>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
