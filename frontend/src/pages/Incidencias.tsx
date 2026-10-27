import { Clock, ListChecks, MapPin, RefreshCw, Search, SearchX, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useIncidencias } from '../api/hooks/incidencias'
import { usePanelIncidencia } from '../components/PanelIncidencia'
import { AvatarIniciales } from '../components/TarjetaIncidencia'
import {
  Badge, BarraFiltros, Button, EmptyState, ErrorState, ETIQUETAS, Input, PageHeader, Seccion, Select, SkeletonLista, Tabla,
} from '../components/ui'
import { antiguedad } from '../lib/bandeja'
import { OPCIONES_CATEGORIA, OPCIONES_PRIORIDAD } from '../lib/etiquetas'
import { ESTADOS, type FiltrosIncidencias, type IncidenciaListaItem } from '../schemas/incidencia'

const LIMITE = 100
const TONO_TIEMPO = { normal: 'text-muted', atencion: 'text-warn font-semibold', vencida: 'text-bad font-semibold' } as const
const ACTIVOS = ['abierta', 'en_proceso', 'en_espera']

/** Sin acentos ni mayúsculas, para comparar «aire» con «Aire acondicionado». */
const plegar = (texto: string) => texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Todas las palabras deben aparecer en título, folio, edificio, aula o técnico. */
function coincide(t: IncidenciaListaItem, consulta: string) {
  const palabras = plegar(consulta).split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return true
  const texto = plegar([t.titulo, t.codigo, t.ubicacion.edificio, t.ubicacion.aula, t.tecnico_asignado?.nombre].filter(Boolean).join(' '))
  return palabras.every((p) => texto.includes(p))
}

type Filtro = 'estado' | 'prioridad' | 'categoria'

/** Lista de todas las incidencias del alcance del usuario: filtros en la URL (servidor) y búsqueda instantánea (cliente). */
export default function Incidencias() {
  const [params, setParams] = useSearchParams()
  const filtros: FiltrosIncidencias = { limite: LIMITE }
  const estado = params.get('estado') ?? ''
  const prioridad = params.get('prioridad') ?? ''
  const categoria = params.get('categoria') ?? ''
  if ((ESTADOS as readonly string[]).includes(estado)) filtros.estado = estado as FiltrosIncidencias['estado']
  if (OPCIONES_PRIORIDAD.some((o) => o.valor === prioridad)) filtros.prioridad = prioridad as FiltrosIncidencias['prioridad']
  if (OPCIONES_CATEGORIA.some((o) => o.valor === categoria)) filtros.categoria = categoria as FiltrosIncidencias['categoria']

  const consulta = useIncidencias(filtros)
  const [texto, setTexto] = useState('')
  const { abrir, panel } = usePanelIncidencia()

  const cambiar = (campo: Filtro, valor: string) => {
    setParams((previos) => {
      const p = new URLSearchParams(previos)
      if (valor) p.set(campo, valor)
      else p.delete(campo)
      return p
    }, { replace: true })
  }
  const limpiar = () => {
    setTexto('')
    setParams((previos) => {
      const p = new URLSearchParams(previos)
      for (const c of ['estado', 'prioridad', 'categoria']) p.delete(c)
      return p
    }, { replace: true })
  }

  const todas = [...(consulta.data ?? [])].sort((a, b) => b.fecha_creacion.localeCompare(a.fecha_creacion))
  const lista = todas.filter((t) => coincide(t, texto))
  const activos = [filtros.estado, filtros.prioridad, filtros.categoria].filter(Boolean).length + (texto.trim() ? 1 : 0)
  const terminoServidor = texto.trim()

  return (
    <div className="pila">
      <PageHeader
        titulo="Incidencias"
        subtitulo="Todas las incidencias que puedes ver, de la más reciente a la más antigua."
        acciones={(
          <Button variante="fantasma" aria-label="Actualizar" icono={<RefreshCw size={20} />}
            cargando={consulta.isFetching && !consulta.isPending} onClick={() => void consulta.refetch()} />
        )}
      />

      <BarraFiltros
        etiqueta="Filtros de incidencias"
        activos={activos}
        abiertaInicial
        acciones={activos > 0 ? <Button variante="fantasma" tamano="sm" icono={<X size={16} />} onClick={limpiar}>Limpiar filtros</Button> : undefined}
      >
        <Input
          tamano="sm"
          etiqueta="Buscar"
          type="search"
          icono={<Search size={16} />}
          placeholder="Título, folio, edificio, aula o técnico"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          autoComplete="off"
          claseCampo="min-w-[16rem] grow"
        />
        <Select tamano="sm" etiqueta="Estado" placeholder="Todos" value={filtros.estado ?? ''}
          opciones={ESTADOS.map((e) => ({ valor: e, texto: ETIQUETAS.estado[e] }))} onChange={(e) => cambiar('estado', e.target.value)} />
        <Select tamano="sm" etiqueta="Prioridad" placeholder="Todas" value={filtros.prioridad ?? ''}
          opciones={OPCIONES_PRIORIDAD} onChange={(e) => cambiar('prioridad', e.target.value)} />
        <Select tamano="sm" etiqueta="Categoría" placeholder="Todas" value={filtros.categoria ?? ''}
          opciones={OPCIONES_CATEGORIA} onChange={(e) => cambiar('categoria', e.target.value)} />
      </BarraFiltros>

      {consulta.isPending && <SkeletonLista etiqueta="Cargando incidencias" />}

      {consulta.isError && (
        <ErrorState titulo="No pudimos cargar las incidencias" mensaje="Revisa tu conexión e intenta de nuevo."
          onReintentar={() => void consulta.refetch()} reintentando={consulta.isFetching} />
      )}

      {consulta.isSuccess && todas.length === 0 && (
        <EmptyState compacto titulo="Sin incidencias" icono={ListChecks}
          descripcion={activos ? 'Ninguna incidencia cumple los filtros.' : 'Todavía no hay incidencias en tu alcance.'}
          accion={activos ? <Button variante="secundario" tamano="sm" onClick={limpiar}>Limpiar filtros</Button> : undefined} />
      )}

      {consulta.isSuccess && todas.length > 0 && lista.length === 0 && (
        <EmptyState compacto titulo="Sin coincidencias" icono={SearchX}
          descripcion={`Ninguna incidencia de la lista coincide con «${terminoServidor}».`}
          accion={terminoServidor.length >= 2 ? (
            <Link to={`/buscar?q=${encodeURIComponent(terminoServidor)}`} className="ui-btn ui-btn--secundario ui-btn--sm">Buscar también en descripciones</Link>
          ) : undefined} />
      )}

      {consulta.isSuccess && lista.length > 0 && (
        <Seccion
          titulo="Lista"
          descripcion={`${lista.length} de ${todas.length} ${todas.length === 1 ? 'incidencia' : 'incidencias'}${todas.length >= LIMITE ? ` · se muestran las ${LIMITE} más recientes; usa los filtros para acotar` : ''}`}
          sinPadding
        >
          <Tabla etiqueta="Incidencias" apilada densa className="ui-tabla--apilada-md">
            <thead>
              <tr>
                <th scope="col">Incidencia</th>
                <th scope="col">Estado</th>
                <th scope="col">Prioridad</th>
                <th scope="col">Categoría</th>
                <th scope="col">Ubicación</th>
                <th scope="col">Técnico</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((t) => {
                const sla = antiguedad(t.fecha_creacion)
                return (
                  <tr key={t._id} className="cursor-pointer" onClick={() => abrir(t._id)}>
                    <td data-label="Incidencia">
                      <div className="flex min-w-0 flex-col">
                        <Link
                          to={`/incidencias/${encodeURIComponent(t._id)}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                            e.preventDefault()
                            abrir(t._id)
                          }}
                          className="line-clamp-2 font-semibold text-ink max-lg:py-3"
                        >
                          {t.titulo}
                        </Link>
                        <span className="flex flex-wrap items-center gap-x-2 text-xs">
                          <span className="tabular-nums text-muted">{t.codigo}</span>
                          <span className={`inline-flex items-center gap-1 ${TONO_TIEMPO[ACTIVOS.includes(t.estado) ? sla.nivel : 'normal']}`}>
                            <Clock size={12} aria-hidden />{sla.texto}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td data-label="Estado"><Badge tipo="estado" valor={t.estado} /></td>
                    <td data-label="Prioridad"><Badge tipo="prioridad" valor={t.prioridad} /></td>
                    <td data-label="Categoría"><Badge tipo="categoria" valor={t.categoria} /></td>
                    <td data-label="Ubicación">
                      <span className="inline-flex items-center gap-1 text-sm text-muted">
                        <MapPin size={14} aria-hidden className="shrink-0" />
                        {[t.ubicacion.edificio, t.ubicacion.aula].filter(Boolean).join(' · ')}
                      </span>
                    </td>
                    <td data-label="Técnico">
                      {t.tecnico_asignado ? (
                        <span className="inline-flex items-center gap-1.5 text-sm text-ink">
                          <AvatarIniciales nombre={t.tecnico_asignado.nombre} />
                          {t.tecnico_asignado.nombre}
                        </span>
                      ) : <span className="text-sm italic text-muted">Sin asignar</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </Tabla>
        </Seccion>
      )}
      {panel}
    </div>
  )
}
