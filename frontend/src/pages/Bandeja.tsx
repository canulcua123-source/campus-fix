import { CheckCheck, CircleCheck, Hand, Hourglass, Inbox, RefreshCw, Search, SearchX } from 'lucide-react'
import { useState } from 'react'
import { useMe } from '../api/hooks/auth'
import { mensajeDeError } from '../api/client'
import { useIncidencias, useTomar } from '../api/hooks/incidencias'
import { useAuth } from '../auth/store'
import { usePanelIncidencia } from '../components/PanelIncidencia'
import { TarjetaIncidencia } from '../components/TarjetaIncidencia'
import { Button, EmptyState, ErrorState, Input, PageHeader, SkeletonLista } from '../components/ui'
import { antiguedad, esMia, filtrarBandeja, ordenarBandeja } from '../lib/bandeja'
import type { IncidenciaListaItem } from '../schemas/incidencia'

/** Sin acentos ni mayúsculas, para comparar «aire» con «Aire acondicionado». */
const plegar = (texto: string) => texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Coincide si todas las palabras aparecen en título, folio, edificio o aula. */
function coincide(t: IncidenciaListaItem, consulta: string) {
  const palabras = plegar(consulta).split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return true
  const texto = plegar([t.titulo, t.codigo, t.ubicacion.edificio, t.ubicacion.aula].filter(Boolean).join(' '))
  return palabras.every((p) => texto.includes(p))
}


/** Bandeja del técnico: sus asignadas y las de su área sin técnico, por prioridad y antigüedad. */
export default function Bandeja() {
  const incidencias = useIncidencias({})
  const me = useMe()
  const tomar = useTomar()
  const [aviso, setAviso] = useState<string | null>(null)
  const { abrir, panel } = usePanelIncidencia()
  // Espejo de POST /tomar: solo el rol técnico con permiso de seguimiento puede autoasignarse.
  const puedeTomar = useAuth((s) => s.usuario?.rol === 'tecnico' && s.tiene('seguimiento:registrar'))
  const { data, refetch, isFetching } = incidencias
  const isPending = incidencias.isPending || me.isPending
  const isError = incidencias.isError || me.isError
  const actualizar = () => {
    void refetch()
    void me.refetch()
  }

  const [consulta, setConsulta] = useState('')
  const propias = ordenarBandeja(filtrarBandeja(data ?? [], 'mias', me.data?._id))
  const porAceptar = ordenarBandeja(filtrarBandeja(data ?? [], 'sin_asignar', me.data?._id))
  // Resueltas por mí: salen de pendientes pero se muestran aparte hasta que el reportante confirme.
  const resueltas = (data ?? []).filter((t) => t.estado === 'resuelta' && esMia(t, me.data?._id))
  const visibles = { resueltas: resueltas.filter((t) => coincide(t, consulta)), propias: propias.filter((t) => coincide(t, consulta)), porAceptar: porAceptar.filter((t) => coincide(t, consulta)) }
  const hayAlgo = propias.length + porAceptar.length + resueltas.length > 0
  const sinCoincidencias = consulta.trim() !== '' && hayAlgo && visibles.propias.length + visibles.porAceptar.length + visibles.resueltas.length === 0
  const listo = !isPending && !isError

  const tarjeta = (t: IncidenciaListaItem, aceptada: boolean | 'resuelta') => (
    <li key={t._id}>
      <TarjetaIncidencia
        incidencia={t}
        onAbrir={abrir}
        tonoTiempo={antiguedad(t.fecha_creacion).nivel}
        accion={aceptada === 'resuelta' ? (
          <p className="m-0 inline-flex items-center gap-1.5 text-sm font-semibold text-muted">
            <Hourglass size={16} aria-hidden /> Esperando confirmación del reportante
          </p>
        ) : aceptada ? (
          <p className="m-0 inline-flex items-center gap-1.5 text-sm font-semibold text-ok">
            <CircleCheck size={16} aria-hidden /> Aceptada por ti
          </p>
        ) : puedeTomar ? (
          <Button
            bloque
            tamano="sm"
            variante="primario"
            icono={<Hand size={16} />}
            aria-label={`Tomar ${t.codigo}`}
            disabled={tomar.isPending}
            cargando={tomar.isPending && tomar.variables === t._id}
            textoCargando="Tomando…"
            onClick={() => {
              setAviso(null)
              tomar.mutate(t._id, { onSuccess: () => setAviso(`Tomaste ${t.codigo}. Ya está en «Asignadas a ti».`) })
            }}
          >
            Tomar
          </Button>
        ) : (
          <p className="m-0 inline-flex items-center gap-1.5 text-sm font-semibold text-warn">
            <Hourglass size={16} aria-hidden /> Por aceptar
          </p>
        )}
      />
    </li>
  )

  return (
    <div className="pila">
      <PageHeader
        titulo="Bandeja"
        subtitulo="Incidencias de tu área por atender"
        acciones={(
          <Button
            variante="fantasma"
            aria-label="Actualizar"
            icono={<RefreshCw size={20} />}
            cargando={isFetching && !isPending}
            onClick={actualizar}
          />
        )}
      />

      <Input
        etiqueta="Buscar en la bandeja"
        etiquetaOculta
        type="search"
        icono={<Search size={18} />}
        placeholder="Buscar por título, folio, edificio o aula"
        value={consulta}
        onChange={(e) => setConsulta(e.target.value)}
        autoComplete="off"
      />

      {aviso && (
        <p role="status" className="m-0 flex items-center gap-2 rounded-input border border-ok bg-panel p-3 text-sm text-ok">
          <CircleCheck size={18} aria-hidden className="shrink-0" />
          {aviso}
        </p>
      )}
      {tomar.isError && (
        <p role="alert" className="m-0 rounded-input border border-bad bg-panel p-3 text-sm text-bad">
          {mensajeDeError(tomar.error, 'No pudimos asignarte la incidencia. Intenta de nuevo.')}
        </p>
      )}

      {isPending && <SkeletonLista etiqueta="Cargando bandeja" />}

      {isError && (
        <ErrorState
          titulo="No pudimos cargar la bandeja"
          mensaje="Revisa tu conexión e intenta de nuevo."
          onReintentar={actualizar}
          reintentando={isFetching || me.isFetching}
        />
      )}

      {listo && sinCoincidencias && (
        <EmptyState
          compacto
          titulo="Sin coincidencias"
          descripcion={`Ninguna incidencia coincide con «${consulta.trim()}».`}
          icono={SearchX}
          accion={<Button variante="secundario" tamano="sm" onClick={() => setConsulta('')}>Limpiar búsqueda</Button>}
        />
      )}

      {listo && !hayAlgo && (
        <EmptyState
          compacto
          titulo="Todo al día"
          descripcion="No tienes incidencias asignadas ni hay pendientes por aceptar en tu área."
          icono={Inbox}
        />
      )}

      {listo && !sinCoincidencias && visibles.propias.length > 0 && (
        <section aria-labelledby="bandeja-propias" className="pila pila--sm">
          <h2 id="bandeja-propias" className="m-0 flex items-center gap-2 text-base font-semibold">
            <CircleCheck size={18} aria-hidden className="text-ok" /> Asignadas a ti
            <span className="rounded-full bg-panel-2 px-2 text-sm font-medium text-muted">{visibles.propias.length}</span>
          </h2>
          <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 xl:grid-cols-3" aria-label="Asignadas a ti">
            {visibles.propias.map((t) => tarjeta(t, true))}
          </ul>
        </section>
      )}

      {listo && !sinCoincidencias && visibles.porAceptar.length > 0 && (
        <section aria-labelledby="bandeja-por-aceptar" className="pila pila--sm">
          <div>
            <h2 id="bandeja-por-aceptar" className="m-0 flex items-center gap-2 text-base font-semibold">
              <Hourglass size={18} aria-hidden className="text-warn" /> Por aceptar
              <span className="rounded-full bg-panel-2 px-2 text-sm font-medium text-muted">{visibles.porAceptar.length}</span>
            </h2>
            {puedeTomar && <p className="m-0 text-sm text-muted">Sin técnico asignado. Tómala para que pase a «Asignadas a ti».</p>}
          </div>
          <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 xl:grid-cols-3" aria-label="Por aceptar">
            {visibles.porAceptar.map((t) => tarjeta(t, false))}
          </ul>
        </section>
      )}
      {listo && !sinCoincidencias && visibles.resueltas.length > 0 && (
        <details className="pila pila--sm" open={consulta.trim() !== ''}>
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-base font-semibold">
            <CheckCheck size={18} aria-hidden className="text-muted" /> Resueltas
            <span className="rounded-full bg-panel-2 px-2 text-sm font-medium text-muted">{visibles.resueltas.length}</span>
            <span className="text-sm font-normal text-muted">· esperan que el reportante confirme (7 días)</span>
          </summary>
          <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 xl:grid-cols-3" aria-label="Resueltas">
            {visibles.resueltas.map((t) => tarjeta(t, 'resuelta'))}
          </ul>
        </details>
      )}
      {panel}
    </div>
  )
}
