import { Clock, Eye, MapPin } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { useState } from 'react'
import { ApiError } from '../api/client'
import { useIncidencia, useRetirar } from '../api/hooks/incidencias'
import { useAuth } from '../auth/store'
import { GaleriaEvidencias } from '../components/GaleriaEvidencias'
import { SubirEvidencia } from '../components/SubirEvidencia'
import { FormSeguimiento } from '../components/FormSeguimiento'
import { Timeline } from '../components/Timeline'
import { EditorTags } from '../components/EditorTags'
import { SelectorPrioridad } from '../components/SelectorPrioridad'
import { ConfirmarSolucion } from '../components/ConfirmarSolucion'
import { AgregarInformacion } from '../components/AgregarInformacion'
import { TomarIncidencia } from '../components/TomarIncidencia'
import { AvatarIniciales } from '../components/TarjetaIncidencia'
import { Badge, BottomSheet, Button, Card, ErrorState, PageHeader, Seccion, Skeleton } from '../components/ui'
import { transicionesDesde } from '../lib/estados'
import { haceCuanto } from '../lib/tiempo'
import {
  datosDetalle, esSoloLectura, formatearFecha, formatearHoras, mensajeErrorDetalle, textoUbicacion,
} from '../lib/detalle'

export default function DetalleIncidencia() {
  const { id = '' } = useParams<{ id: string }>()
  return <VistaDetalleIncidencia id={id} />
}

/** Detalle completo de una incidencia; `enPanel` lo adapta al panel lateral (una columna, sin «Volver»). */
export function VistaDetalleIncidencia({ id, enPanel = false }: { id: string; enPanel?: boolean }) {
  const { data: detalle, isPending, isError, error, isFetching, refetch } = useIncidencia(id)
  const retirar = useRetirar(id)
  const { usuario } = useAuth()
  const [confirmandoRetiro, setConfirmandoRetiro] = useState(false)
  const [retiroExitoso, setRetiroExitoso] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  if (isPending) {
    return (
      <>
        <PageHeader titulo="Detalle" atras={enPanel ? undefined : { to: '/', texto: 'Volver' }} />
        <div role="status" aria-label="Cargando incidencia." className={enPanel ? 'grid gap-4' : 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]'}>
          <div className="pila">
            <Card className="flex flex-col gap-2">
              <Skeleton ancho="45%" alto={12} />
              <Skeleton ancho="80%" alto={22} />
              <div className="flex gap-2">
                <Skeleton ancho={86} alto={20} redondo />
                <Skeleton ancho={70} alto={20} redondo />
              </div>
            </Card>
            <Card><Skeleton alto={92} /></Card>
            <Card><Skeleton alto={150} /></Card>
          </div>
          <div className="pila">
            <Card><Skeleton alto={120} /></Card>
            <Card><Skeleton alto={60} /></Card>
          </div>
        </div>
      </>
    )
  }

  if (isError || !detalle) {
    const info = mensajeErrorDetalle(error instanceof ApiError ? error.status : 500)
    return (
      <>
        <PageHeader titulo="Detalle de incidencia" atras={enPanel ? undefined : { to: '/', texto: 'Volver' }} />
        <ErrorState
          titulo={info.titulo}
          mensaje={info.mensaje}
          onReintentar={info.puedeReintentar ? () => void refetch() : undefined}
          reintentando={isFetching}
        />
        {!info.puedeReintentar && (
          <p className="text-center">
            <Link to="/" className="ui-btn ui-btn--secundario">Volver al inicio</Link>
          </p>
        )}
      </>
    )
  }

  const soloLectura = esSoloLectura(usuario?.permisos ?? [])
  const puedeCambiarPrioridad = (usuario?.permisos.includes('incidencias:asignar') ?? false)
    && detalle.estado !== 'cerrada' && detalle.estado !== 'retirada'
  // Espejo de POST /tomar: solo rol técnico, sin técnico asignado y en estado activo (la API decide).
  const puedeTomar = usuario?.rol === 'tecnico' && (usuario.permisos.includes('seguimiento:registrar'))
    && !detalle.tecnico_asignado && ['abierta', 'en_proceso', 'en_espera'].includes(detalle.estado)
  const permisos = usuario?.permisos ?? []
  const puedeCerrar = permisos.includes('incidencias:asignar')
  const puedeSeguimiento = permisos.includes('seguimiento:registrar')
    && transicionesDesde(detalle.estado).some((e) => e !== 'cerrada' || puedeCerrar)
  const generales = [
    { etiqueta: 'Ubicación', valor: textoUbicacion(detalle.ubicacion) },
    { etiqueta: 'Reportante', valor: detalle.reportante.nombre },
    {
      etiqueta: 'Técnico',
      valor: detalle.tecnico_asignado ? (
        <span className="inline-flex items-center gap-1.5">
          <AvatarIniciales nombre={detalle.tecnico_asignado.nombre} />
          {detalle.tecnico_asignado.nombre}
        </span>
      ) : <span className="italic text-muted">Sin asignar</span>,
    },
    { etiqueta: 'Horas invertidas', valor: formatearHoras(detalle.horas_invertidas) },
    { etiqueta: 'Reportada', valor: formatearFecha(detalle.fecha_creacion) },
    ...(detalle.fecha_actualizacion ? [{ etiqueta: 'Última actualización', valor: formatearFecha(detalle.fecha_actualizacion) }] : []),
    ...(detalle.fecha_resolucion ? [{ etiqueta: 'Resuelta el', valor: formatearFecha(detalle.fecha_resolucion) }] : []),
  ]
  const especificos = datosDetalle(detalle.detalle_especifico)
  const ubicacionCorta = [detalle.ubicacion.edificio, detalle.ubicacion.aula].filter(Boolean).join(' · ')

  return (
    <>
      <PageHeader
        titulo={detalle.titulo}
        subtitulo={detalle.codigo}
        atras={enPanel ? undefined : { to: '/', texto: 'Volver' }}
        acciones={soloLectura ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-sm text-muted">
            <Eye size={14} aria-hidden />
            <span>Solo lectura</span>
          </span>
        ) : undefined}
      />

      <div className="mb-4 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tipo="estado" valor={detalle.estado} />
          <Badge tipo="prioridad" valor={detalle.prioridad} />
          <Badge tipo="categoria" valor={detalle.categoria} />
        </div>
        <p className="m-0 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
          {ubicacionCorta && (
            <span className="inline-flex items-center gap-1"><MapPin size={14} aria-hidden />{ubicacionCorta}</span>
          )}
          <span className="inline-flex items-center gap-1"><Clock size={14} aria-hidden />Reportada {haceCuanto(detalle.fecha_creacion).toLowerCase()}</span>
        </p>
      </div>

      {(aviso || retiroExitoso || retirar.isError) && (
        <div className="mb-4 flex flex-col gap-2">
          {aviso && (
            <p role="status" className="m-0 rounded-input border border-ok bg-panel p-3 text-sm text-ok">{aviso}</p>
          )}
          {retiroExitoso && (
            <p role="status" className="m-0 rounded-input border border-ok bg-panel p-3 text-sm text-ok">
              Tu reporte fue retirado correctamente.
            </p>
          )}
          {retirar.isError && (
            <p role="alert" className="m-0 rounded-input border border-bad bg-panel p-3 text-sm text-bad">
              {retirar.error instanceof ApiError && retirar.error.status === 409
                ? 'Este reporte ya no puede retirarse porque cambió de estado, fue asignado o venció el plazo.'
                : retirar.error instanceof ApiError
                  ? retirar.error.mensaje
                  : 'No pudimos retirar el reporte. Intenta de nuevo.'}
            </p>
          )}
        </div>
      )}

      <div className={enPanel ? 'grid gap-4' : 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] lg:grid-rows-[auto_auto_1fr] lg:items-start'}>
        {/* Acciones: arriba en móvil; columna lateral en escritorio. */}
        <div className={enPanel ? 'pila empty:hidden' : 'pila empty:hidden lg:col-start-2 lg:row-start-1'}>
          {detalle.estado === 'resuelta' && (
            <ConfirmarSolucion
              incidenciaId={detalle._id}
              reportanteId={detalle.reportante.usuario_id}
              fechaResolucion={detalle.fecha_resolucion}
              onHecho={setAviso}
            />
          )}

          {detalle.estado === 'en_espera' && (
            <AgregarInformacion incidenciaId={detalle._id} reportanteId={detalle.reportante.usuario_id} />
          )}

          {puedeTomar && <TomarIncidencia incidenciaId={detalle._id} onHecho={setAviso} />}

          {detalle.puede_retirar && detalle.estado === 'abierta' && !detalle.tecnico_asignado && (
            <Card como="section">
              <h2 className="mb-1 mt-0 text-base font-semibold text-ink">¿Ya no necesitas este reporte?</h2>
              <p className="mb-3 mt-0 text-sm text-muted">
                Puedes retirarlo durante los primeros 15 minutos, siempre que aún no tenga técnico asignado.
              </p>
              <Button
                variante="peligro"
                onClick={() => {
                  retirar.reset()
                  setConfirmandoRetiro(true)
                }}
              >
                Retirar mi reporte
              </Button>
            </Card>
          )}

          {puedeCambiarPrioridad && (
            <Seccion titulo="Prioridad de atención">
              <SelectorPrioridad incidenciaId={detalle._id} prioridad={detalle.prioridad} />
            </Seccion>
          )}

          {puedeSeguimiento && (
            <FormSeguimiento
              incidenciaId={detalle._id}
              estadoActual={detalle.estado}
              puedeRegistrar
              puedeCerrar={puedeCerrar}
              onSeguimientoGuardado={() => void refetch()}
            />
          )}
        </div>

        <div className={enPanel ? 'pila min-w-0' : 'pila min-w-0 lg:col-start-1 lg:row-span-3 lg:row-start-1'}>
          <Seccion titulo="Descripción">
            <p className="m-0 whitespace-pre-line text-ink">{detalle.descripcion}</p>
          </Seccion>

          <Seccion
            titulo="Evidencias"
            descripcion={detalle.evidencias_adjuntas.length > 0
              ? `${detalle.evidencias_adjuntas.length} ${detalle.evidencias_adjuntas.length === 1 ? 'archivo adjunto' : 'archivos adjuntos'}`
              : undefined}
          >
            <div className="pila">
              <GaleriaEvidencias incidenciaId={detalle._id} evidencias={detalle.evidencias_adjuntas} />
              {permisos.includes('evidencias:subir') && (
                <SubirEvidencia incidenciaId={detalle._id} cantidad={detalle.evidencias_adjuntas.length} />
              )}
            </div>
          </Seccion>

          <Seccion titulo="Bitácora">
            <Timeline
              entradas={detalle.historial_seguimiento}
              reportante={detalle.reportante}
              tecnico={detalle.tecnico_asignado}
            />
          </Seccion>
        </div>

        <div className={enPanel ? 'pila' : 'pila lg:col-start-2 lg:row-start-2'}>
          <Seccion titulo="Detalles">
            <dl className="m-0 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              {generales.map((dato) => (
                <div key={dato.etiqueta}>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{dato.etiqueta}</dt>
                  <dd className="m-0 mt-0.5 text-sm text-ink">{dato.valor}</dd>
                </div>
              ))}
            </dl>
            {especificos.length > 0 && (
              <>
                <h3 className="mb-2 mt-4 border-t border-line pt-3 text-sm font-semibold text-ink">Datos técnicos</h3>
                <dl className="m-0 grid gap-3 sm:grid-cols-2">
                  {especificos.map((dato) => (
                    <div key={dato.etiqueta}>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{dato.etiqueta}</dt>
                      <dd className="m-0 mt-0.5 text-sm text-ink">{dato.valor}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
          </Seccion>

          <Seccion titulo="Etiquetas técnicas">
            <EditorTags incidenciaId={detalle._id} tags={detalle.tags} />
          </Seccion>
        </div>
      </div>

      {/* Espacio para el botón fijo de seguimiento en móvil. */}
      {puedeSeguimiento && <div aria-hidden className="h-16 lg:hidden" />}

      <BottomSheet
        abierto={confirmandoRetiro}
        onCerrar={() => {
          if (!retirar.isPending) setConfirmandoRetiro(false)
        }}
        titulo="Confirmar retiro"
        acciones={(
          <>
            <Button variante="secundario" disabled={retirar.isPending} onClick={() => setConfirmandoRetiro(false)}>
              Cancelar
            </Button>
            <Button
              variante="peligro"
              cargando={retirar.isPending}
              textoCargando="Retirando…"
              onClick={() => retirar.mutate(undefined, {
                onSuccess: () => {
                  setRetiroExitoso(true)
                  setConfirmandoRetiro(false)
                },
                onError: () => setConfirmandoRetiro(false),
              })}
            >
              Sí, retirar reporte
            </Button>
          </>
        )}
      >
        <p className="m-0 text-sm text-ink">
          El reporte dejará de ser atendido y permanecerá en el historial con estado Retirada. Esta acción no se puede deshacer.
        </p>
      </BottomSheet>
    </>
  )
}
