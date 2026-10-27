import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Building2, ChevronDown, SearchX } from 'lucide-react'
import { catalogoAulasQuery } from '../api/aulas'
import { mensajeDeError } from '../api/client'
import { Card, EmptyState, ErrorState, Input, PageHeader, SkeletonLista } from '../components/ui'
import type { AulaCatalogo, EdificioCatalogo } from '../schemas/aula'

const normalizar = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()

const nombrePiso = (piso: number) => (piso === 0 ? 'Planta baja' : piso < 0 ? `Sótano ${-piso}` : `Piso ${piso}`)

/** Si el edificio coincide se muestran todas sus aulas; si no, solo las aulas que coinciden. */
function filtrar(edificios: EdificioCatalogo[], busqueda: string): EdificioCatalogo[] {
  const q = normalizar(busqueda)
  if (!q) return edificios
  return edificios.flatMap((e) => {
    if (normalizar(e.edificio).includes(q)) return [e]
    const aulas = e.aulas.filter((a) => normalizar(a.aula).includes(q))
    return aulas.length ? [{ ...e, aulas }] : []
  })
}

function porPiso(aulas: AulaCatalogo[]): [number, AulaCatalogo[]][] {
  const grupos = new Map<number, AulaCatalogo[]>()
  for (const a of aulas) grupos.set(a.piso, [...(grupos.get(a.piso) ?? []), a])
  return [...grupos.entries()].sort(([a], [b]) => a - b)
}

function EstadoAula({ activa }: { activa: boolean }) {
  return <span className={activa ? 'text-sm font-semibold text-ok' : 'text-sm text-muted'}>{activa ? 'Activa' : 'Inactiva'}</span>
}

function TarjetaEdificio({ edificio, filtrado }: { edificio: EdificioCatalogo; filtrado: boolean }) {
  const inactivas = edificio.total_aulas - edificio.activas
  return (
    <Card como="li" className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <Building2 size={22} aria-hidden className="mt-0.5 shrink-0 text-muted" />
        <div className="min-w-0">
          <h2 className="m-0 text-base font-semibold text-ink">{edificio.edificio}</h2>
          <p className="m-0 text-sm text-muted">
            {edificio.total_aulas} {edificio.total_aulas === 1 ? 'aula' : 'aulas'} · {edificio.activas} {edificio.activas === 1 ? 'activa' : 'activas'}
            {inactivas > 0 && ` · ${inactivas} ${inactivas === 1 ? 'inactiva' : 'inactivas'}`}
            {' · '}{edificio.pisos.length} {edificio.pisos.length === 1 ? 'piso' : 'pisos'}
          </p>
        </div>
      </div>
      <details open={filtrado} className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold text-ink">
          <ChevronDown size={18} aria-hidden className="transition-transform group-open:rotate-180" />
          {filtrado ? `Aulas encontradas (${edificio.aulas.length})` : 'Ver aulas por piso'}
        </summary>
        <div className="mt-2 flex flex-col gap-3">
          {porPiso(edificio.aulas).map(([piso, aulas]) => (
            <section key={piso} aria-label={`${edificio.edificio}, ${nombrePiso(piso)}`}>
              <h3 className="m-0 mb-1 text-sm font-semibold text-muted">{nombrePiso(piso)}</h3>
              <ul className="m-0 flex list-none flex-col p-0">
                {aulas.map((a) => (
                  <li key={a.id_publico} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 last:border-b-0">
                    <div className="min-w-0">
                      <p className="m-0 text-ink">{a.aula}</p>
                      <p className="m-0 break-all text-sm text-muted">QR: {a.id_publico}</p>
                    </div>
                    <EstadoAula activa={a.activa} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </details>
    </Card>
  )
}

export default function AdminEdificios() {
  const catalogo = useQuery(catalogoAulasQuery())
  const [busqueda, setBusqueda] = useState('')
  const visibles = useMemo(() => filtrar(catalogo.data ?? [], busqueda), [catalogo.data, busqueda])
  const filtrado = normalizar(busqueda) !== ''

  return (
    <div className="flex flex-col gap-4">
      <PageHeader titulo="Edificios y aulas" subtitulo="Catálogo de espacios del campus (solo consulta)" />
      {catalogo.isPending ? (
        <SkeletonLista etiqueta="Cargando edificios" />
      ) : catalogo.isError ? (
        <ErrorState mensaje={mensajeDeError(catalogo.error, 'No se pudo cargar el catálogo de aulas')}
          onReintentar={() => void catalogo.refetch()} reintentando={catalogo.isFetching} />
      ) : catalogo.data.length === 0 ? (
        <EmptyState titulo="Aún no hay aulas registradas" icono={Building2}
          descripcion="Cuando se carguen aulas en el catálogo aparecerán aquí agrupadas por edificio." />
      ) : (
        <>
          <Input etiqueta="Buscar edificio o aula" type="search" value={busqueda} placeholder="Ej. Edificio A o A-201"
            onChange={(e) => setBusqueda(e.target.value)} />
          <p role="status" className="m-0 text-sm text-muted">
            {visibles.length} {visibles.length === 1 ? 'edificio' : 'edificios'}
          </p>
          {visibles.length === 0 ? (
            <EmptyState titulo="Sin resultados" icono={SearchX} descripcion={`Ningún edificio ni aula coincide con “${busqueda.trim()}”.`} />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {visibles.map((e) => <TarjetaEdificio key={e.edificio} edificio={e} filtrado={filtrado} />)}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
