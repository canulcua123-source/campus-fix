import { Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useBuscar } from '../api/hooks/incidencias'
import { busquedaSchema } from '../schemas/incidencia'
import { Badge, Card, EmptyState, ErrorState, Skeleton } from '../components/ui'

function TextoResaltado({ texto, termino }: { texto: string; termino: string }) {
  const buscado = termino.trim().toLocaleLowerCase('es-MX')
  if (!buscado) return <>{texto}</>
  const normalizado = texto.toLocaleLowerCase('es-MX')
  const partes: ReactNode[] = []
  let desde = 0
  let encontrado = normalizado.indexOf(buscado, desde)
  while (encontrado >= 0) {
    if (encontrado > desde) partes.push(texto.slice(desde, encontrado))
    partes.push(<mark key={encontrado} className="rounded bg-warn px-0.5 text-on-warn">{texto.slice(encontrado, encontrado + buscado.length)}</mark>)
    desde = encontrado + buscado.length
    encontrado = normalizado.indexOf(buscado, desde)
  }
  if (desde < texto.length) partes.push(texto.slice(desde))
  return <>{partes}</>
}

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
