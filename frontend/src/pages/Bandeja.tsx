import { CircleCheck, Hand, Inbox, RefreshCw, Search, SearchX } from 'lucide-react'
import { useState } from 'react'
import { useMe } from '../api/hooks/auth'
import { mensajeDeError } from '../api/client'
import { useIncidencias, useTomar } from '../api/hooks/incidencias'
import { useAuth } from '../auth/store'
import { usePanelIncidencia } from '../components/PanelIncidencia'
import { TarjetaIncidencia } from '../components/TarjetaIncidencia'
import { Button, EmptyState, ErrorState, Input, PageHeader, Segmentado, SkeletonLista } from '../components/ui'
import { antiguedad, filtrarBandeja, ordenarBandeja, type PestanaBandeja } from '../lib/bandeja'
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

const PESTANAS: { clave: PestanaBandeja; texto: string }[] = [
  { clave: 'mias', texto: 'Mis asignadas' },
  { clave: 'sin_asignar', texto: 'Sin asignar' },
]

/** Bandeja del técnico: sus asignadas y las de su área sin técnico, por prioridad y antigüedad. */
export default function Bandeja() {
  const [pestana, setPestana] = useState<PestanaBandeja>('mias')
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

  const conteo = {
    mias: filtrarBandeja(data ?? [], 'mias', me.data?._id).length,
    sin_asignar: filtrarBandeja(data ?? [], 'sin_asignar', me.data?._id).length,
  }
  const [consulta, setConsulta] = useState('')
  const deLaPestana = ordenarBandeja(filtrarBandeja(data ?? [], pestana, me.data?._id))
  const lista = deLaPestana.filter((t) => coincide(t, consulta))
  const sinCoincidencias = consulta.trim() !== '' && deLaPestana.length > 0 && lista.length === 0

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

      <Segmentado
        etiqueta="Incidencias de la bandeja"
        valor={pestana}
        onCambio={(v) => {
          setPestana(v)
          setAviso(null)
        }}
        className="flex w-full [&>button]:flex-1"
        opciones={PESTANAS.map((p) => ({
          valor: p.clave,
          texto: isPending ? p.texto : `${p.texto} · ${conteo[p.clave]}`,
        }))}
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

      {!isPending && !isError && sinCoincidencias && (
        <EmptyState
          compacto
          titulo="Sin coincidencias"
          descripcion={`Ninguna incidencia de esta pestaña coincide con «${consulta.trim()}».`}
          icono={SearchX}
          accion={<Button variante="secundario" tamano="sm" onClick={() => setConsulta('')}>Limpiar búsqueda</Button>}
        />
      )}

      {!isPending && !isError && !sinCoincidencias && lista.length === 0 && (
        <EmptyState
          compacto
          titulo={pestana === 'mias' ? 'Sin incidencias asignadas' : 'Sin incidencias por asignar'}
          descripcion={
            pestana === 'mias'
              ? 'Cuando te asignen una incidencia de tu área aparecerá aquí.'
              : 'No hay incidencias pendientes de asignación en tu área.'
          }
          icono={Inbox}
          accion={pestana === 'mias' && conteo.sin_asignar > 0 ? (
            <Button variante="secundario" tamano="sm" onClick={() => setPestana('sin_asignar')}>
              Ver {conteo.sin_asignar} sin asignar
            </Button>
          ) : undefined}
        />
      )}

      {!isPending && !isError && lista.length > 0 && (
        <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 xl:grid-cols-3" aria-label="Incidencias">
          {lista.map((t) => (
            <li key={t._id}>
              <TarjetaIncidencia
                incidencia={t}
                onAbrir={abrir}
                tonoTiempo={antiguedad(t.fecha_creacion).nivel}
                accion={puedeTomar && !t.tecnico_asignado ? (
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
                      tomar.mutate(t._id, { onSuccess: () => setAviso(`Tomaste ${t.codigo}. Ya aparece en Mis asignadas.`) })
                    }}
                  >
                    Tomar
                  </Button>
                ) : undefined}
              />
            </li>
          ))}
        </ul>
      )}
      {panel}
    </div>
  )
}
