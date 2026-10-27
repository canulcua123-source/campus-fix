import { useMemo, useState, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Building2, Check, ChevronDown, CircleCheck, CircleOff, Copy, DoorOpen, QrCode, Search, SearchX } from 'lucide-react'
import { catalogoAulasQuery } from '../api/aulas'
import { mensajeDeError } from '../api/client'
import {
  BarraFiltros, Button, EmptyState, ErrorState, Input, PageHeader, Seccion, Segmentado, SkeletonLista, StatGrid, StatTile, Tabla,
} from '../components/ui'
import type { AulaCatalogo, EdificioCatalogo } from '../schemas/aula'

type FiltroEstado = 'todas' | 'activas' | 'inactivas'

const normalizar = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

const nombrePiso = (piso: number) => (piso === 0 ? 'Planta baja' : piso < 0 ? `Sótano ${-piso}` : `Piso ${piso}`)

/** Si el edificio coincide se muestran todas sus aulas; si no, solo las aulas que coinciden. Luego filtra por estado. */
function filtrar(edificios: EdificioCatalogo[], busqueda: string, estado: FiltroEstado): EdificioCatalogo[] {
  const q = normalizar(busqueda)
  return edificios.flatMap((e) => {
    let aulas = q && !normalizar(e.edificio).includes(q) ? e.aulas.filter((a) => normalizar(a.aula).includes(q)) : e.aulas
    if (estado !== 'todas') aulas = aulas.filter((a) => a.activa === (estado === 'activas'))
    if (!aulas.length && (q || estado !== 'todas')) return []
    return [{ ...e, aulas }]
  })
}

function porPiso(aulas: AulaCatalogo[]): [number, AulaCatalogo[]][] {
  const grupos = new Map<number, AulaCatalogo[]>()
  for (const a of aulas) grupos.set(a.piso, [...(grupos.get(a.piso) ?? []), a])
  return [...grupos.entries()].sort(([a], [b]) => a - b)
}

const ordenarAulas = (aulas: AulaCatalogo[]) =>
  [...aulas].sort((a, b) => a.piso - b.piso || a.aula.localeCompare(b.aula, 'es', { numeric: true }))

function EstadoAula({ activa }: { activa: boolean }) {
  const token = activa ? '--estado-resuelta' : '--estado-cerrada'
  return (
    <span className="ui-badge" style={{ '--badge-bg': `var(${token}-bg)`, '--badge-text': `var(${token}-text)` } as CSSProperties}>
      {activa ? 'Activa' : 'Inactiva'}
    </span>
  )
}

function CopiarQR({ aula }: { aula: AulaCatalogo }) {
  const [copiado, setCopiado] = useState(false)
  async function copiar() {
    try {
      await navigator.clipboard.writeText(aula.id_publico)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    } catch {
      setCopiado(false)
    }
  }
  return (
    <Button variante="fantasma" tamano="sm" aria-label={copiado ? `QR de ${aula.aula} copiado` : `Copiar QR de ${aula.aula}`}
      icono={copiado ? <Check size={16} className="text-ok" /> : <Copy size={16} />} onClick={() => void copiar()} />
  )
}

function SeccionEdificio({ edificio, total, filtrado }: { edificio: EdificioCatalogo; total: EdificioCatalogo | undefined; filtrado: boolean }) {
  const [abierto, setAbierto] = useState<boolean | null>(null)
  const expandido = abierto ?? filtrado
  const base = total ?? edificio
  const inactivas = base.total_aulas - base.activas
  const resumen = `${plural(base.total_aulas, 'aula', 'aulas')} · ${plural(base.activas, 'activa', 'activas')}`
    + (inactivas > 0 ? ` · ${plural(inactivas, 'inactiva', 'inactivas')}` : '')
    + ` · ${plural(base.pisos.length, 'piso', 'pisos')}`
  const descripcion = filtrado ? `${edificio.aulas.length} de ${plural(base.total_aulas, 'aula coincide', 'aulas coinciden')}` : resumen
  return (
    <Seccion titulo={edificio.edificio} descripcion={descripcion} sinPadding={expandido && edificio.aulas.length > 0}
      acciones={edificio.aulas.length > 0 && (
        <Button variante="fantasma" tamano="sm" aria-expanded={expandido} onClick={() => setAbierto(!expandido)}
          icono={<ChevronDown size={16} className={expandido ? 'rotate-180 transition-transform' : 'transition-transform'} />}>
          {expandido ? 'Ocultar' : 'Ver aulas'}
        </Button>
      )}>
      {edificio.aulas.length === 0 ? (
        <p className="m-0 text-sm text-muted">Sin aulas registradas en este edificio.</p>
      ) : expandido ? (
        <Tabla etiqueta={`Aulas de ${edificio.edificio}`} apilada densa>
          <thead>
            <tr><th scope="col">Aula</th><th scope="col">Piso</th><th scope="col">Estado</th><th scope="col">ID del QR</th></tr>
          </thead>
          <tbody>
            {ordenarAulas(edificio.aulas).map((a) => (
              <tr key={a.id_publico}>
                <td data-label="Aula" className="font-semibold text-ink">{a.aula}</td>
                <td data-label="Piso">{nombrePiso(a.piso)}</td>
                <td data-label="Estado"><EstadoAula activa={a.activa} /></td>
                <td data-label="ID del QR">
                  <span className="inline-flex items-center gap-1">
                    <code className="break-all text-sm text-muted">{a.id_publico}</code>
                    <CopiarQR aula={a} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      ) : (
        <ul aria-label={`Pisos de ${edificio.edificio}`} className="m-0 flex list-none flex-wrap gap-2 p-0">
          {porPiso(edificio.aulas).map(([piso, aulas]) => (
            <li key={piso} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel-2 px-3 py-1 text-sm text-ink">
              <span className="font-semibold">{nombrePiso(piso)}</span>
              <span className="text-muted">· {plural(aulas.length, 'aula', 'aulas')}</span>
            </li>
          ))}
        </ul>
      )}
    </Seccion>
  )
}

export default function AdminEdificios() {
  const catalogo = useQuery(catalogoAulasQuery())
  const [busqueda, setBusqueda] = useState('')
  const [estado, setEstado] = useState<FiltroEstado>('todas')
  const datos = useMemo(() => catalogo.data ?? [], [catalogo.data])
  const visibles = useMemo(() => filtrar(datos, busqueda, estado), [datos, busqueda, estado])
  const filtrado = normalizar(busqueda) !== '' || estado !== 'todas'
  const totales = useMemo(() => {
    const aulas = datos.reduce((s, e) => s + e.total_aulas, 0)
    const activas = datos.reduce((s, e) => s + e.activas, 0)
    return { edificios: datos.length, aulas, activas, inactivas: aulas - activas }
  }, [datos])
  const limpiar = () => { setBusqueda(''); setEstado('todas') }

  return (
    <div className="pila">
      <PageHeader titulo="Edificios y aulas" subtitulo="Espacios del campus y sus QR (solo consulta)." />
      {catalogo.isPending ? (
        <SkeletonLista etiqueta="Cargando edificios" />
      ) : catalogo.isError ? (
        <ErrorState mensaje={mensajeDeError(catalogo.error, 'No se pudo cargar el catálogo de aulas')}
          onReintentar={() => void catalogo.refetch()} reintentando={catalogo.isFetching} />
      ) : datos.length === 0 ? (
        <EmptyState titulo="Aún no hay aulas registradas" icono={QrCode}
          descripcion="Se dan de alta desde el CSV del campus; el script generar_qr_aulas.py les asigna su ID y genera el QR. Al cargarlas aparecerán aquí por edificio." />
      ) : (
        <>
          <StatGrid columnas={4} etiqueta="Resumen del catálogo">
            <StatTile etiqueta="Edificios" valor={totales.edificios} icono={<Building2 size={18} />} />
            <StatTile etiqueta="Aulas" valor={totales.aulas} icono={<DoorOpen size={18} />} tono="brand" />
            <StatTile etiqueta="Activas" valor={totales.activas} icono={<CircleCheck size={18} />} tono="success" />
            <StatTile etiqueta="Inactivas" valor={totales.inactivas} icono={<CircleOff size={18} />} />
          </StatGrid>
          <BarraFiltros etiqueta="Filtrar aulas" activos={(busqueda.trim() ? 1 : 0) + (estado !== 'todas' ? 1 : 0)}
            acciones={filtrado && <Button variante="fantasma" tamano="sm" onClick={limpiar}>Limpiar</Button>}>
            <Input etiqueta="Buscar edificio o aula" etiquetaOculta tamano="sm" type="search" icono={<Search size={16} />}
              value={busqueda} placeholder="Buscar edificio o aula (ej. A-201)" onChange={(e) => setBusqueda(e.target.value)} />
            <Segmentado etiqueta="Estado" tamano="sm" valor={estado} onCambio={setEstado}
              opciones={[{ valor: 'todas', texto: 'Todas' }, { valor: 'activas', texto: 'Activas' }, { valor: 'inactivas', texto: 'Inactivas' }]} />
          </BarraFiltros>
          <p role="status" className="m-0 text-sm text-muted">
            {plural(visibles.length, 'edificio', 'edificios')}
            {filtrado && ` · ${plural(visibles.reduce((s, e) => s + e.aulas.length, 0), 'aula', 'aulas')}`}
          </p>
          {visibles.length === 0 ? (
            <EmptyState compacto titulo="Sin resultados" icono={SearchX}
              descripcion={busqueda.trim() ? `Ningún edificio ni aula coincide con “${busqueda.trim()}”.` : 'Ninguna aula con ese estado.'}
              accion={<Button variante="secundario" tamano="sm" onClick={limpiar}>Limpiar filtros</Button>} />
          ) : (
            visibles.map((e) => (
              <SeccionEdificio key={e.edificio} edificio={e} filtrado={filtrado} total={datos.find((d) => d.edificio === e.edificio)} />
            ))
          )}
        </>
      )}
    </div>
  )
}
