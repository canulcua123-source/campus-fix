import { Link, useParams } from 'react-router-dom'
import { useState } from 'react'
import { ApiError } from '../api/client'
import { useIncidencia, useRetirar } from '../api/hooks/incidencias'
import { useAuth } from '../auth/store'
import { GaleriaEvidencias } from '../components/GaleriaEvidencias'
import { FormSeguimiento } from '../components/FormSeguimiento'
import { Timeline } from '../components/Timeline'
import { EditorTags } from '../components/EditorTags'
import { Badge, BottomSheet, Button, Card, ErrorState, PageHeader, Skeleton } from '../components/ui'
import {
  datosDetalle, esSoloLectura, formatearFecha, formatearHoras, mensajeErrorDetalle, textoUbicacion,
} from '../lib/detalle'

export default function DetalleIncidencia() {
  const { id = '' } = useParams<{ id: string }>()
  const { data: detalle, isPending, isError, error, isFetching, refetch } = useIncidencia(id)
  const retirar = useRetirar(id)
  const { usuario } = useAuth()
  const [confirmandoRetiro, setConfirmandoRetiro] = useState(false)
  const [retiroExitoso, setRetiroExitoso] = useState(false)

  if (isPending) {
    return (
      <>
        <PageHeader titulo="Detalle" atras={{ to: '/', texto: 'Volver' }} />
        <div role="status" aria-label="Cargando incidencia." className="flex flex-col gap-3">
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
      </>
    )
  }

  if (isError || !detalle) {
    const info = mensajeErrorDetalle(error instanceof ApiError ? error.status : 500)
    return (
      <>
        <PageHeader titulo="Detalle de incidencia" atras={{ to: '/', texto: 'Volver' }} />
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
  const puedeEditarTags = usuario?.permisos.includes('tags:gestionar') ?? false
  const datos = [
    { etiqueta: 'Ubicación', valor: textoUbicacion(detalle.ubicacion) },
    { etiqueta: 'Reportante', valor: detalle.reportante.nombre },
    ...(detalle.tecnico_asignado ? [{ etiqueta: 'Técnico', valor: detalle.tecnico_asignado.nombre }] : []),
    { etiqueta: 'Horas invertidas', valor: formatearHoras(detalle.horas_invertidas) },
    ...(detalle.fecha_resolucion ? [{ etiqueta: 'Resuelta el', valor: formatearFecha(detalle.fecha_resolucion) }] : []),
    ...datosDetalle(detalle.detalle_especifico),
  ]

  return (
    <>
      <PageHeader
        titulo={detalle.titulo}
        subtitulo={detalle.codigo}
        atras={{ to: '/', texto: 'Volver' }}
        acciones={soloLectura ? <span className="text-sm text-muted">Solo lectura</span> : undefined}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tipo="estado" valor={detalle.estado} />
        <Badge tipo="prioridad" valor={detalle.prioridad} />
        <Badge tipo="categoria" valor={detalle.categoria} />

      </div>

      {detalle.puede_retirar && detalle.estado === 'abierta' && !detalle.tecnico_asignado && (
        <Card como="section" className="mb-3">
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

      {retiroExitoso && (
        <p role="status" className="mb-3 rounded-input border border-ok p-3 text-sm text-ok">
          Tu reporte fue retirado correctamente.
        </p>
      )}
      {retirar.isError && (
        <p role="alert" className="mb-3 rounded-input border border-bad p-3 text-sm text-bad">
          {retirar.error instanceof ApiError && retirar.error.status === 409
            ? 'Este reporte ya no puede retirarse porque cambió de estado, fue asignado o venció el plazo.'
            : retirar.error instanceof ApiError
              ? retirar.error.mensaje
              : 'No pudimos retirar el reporte. Intenta de nuevo.'}
        </p>
      )}

      <Card como="section">
        <p className="m-0 whitespace-pre-line text-ink">{detalle.descripcion}</p>
        <p className="mb-0 mt-3 text-sm text-muted">Reportada el {formatearFecha(detalle.fecha_creacion)}</p>
      </Card>

      <Card como="section" className="mt-3">
        <h2 className="mb-3 mt-0 text-base font-semibold text-ink">Etiquetas técnicas</h2>
        {puedeEditarTags ? (
          <EditorTags incidenciaId={detalle._id} tags={detalle.tags} />
        ) : (
          <div className="flex flex-wrap gap-2" aria-label="Etiquetas actuales">
            {detalle.tags.length === 0 && <p className="m-0 text-sm text-muted">Esta incidencia todavía no tiene etiquetas.</p>}
            {detalle.tags.map((tag) => (
              <span key={tag} className="rounded-full border border-line bg-panel-2 px-3 py-2 text-sm text-ink">#{tag}</span>
            ))}
          </div>
        )}
      </Card>

      <Card como="section" className="mt-3">
        <h2 className="mb-3 mt-0 text-base font-semibold text-ink">Detalle</h2>
        <dl className="m-0 grid gap-3 sm:grid-cols-2">
          {datos.map((dato) => (
            <div key={dato.etiqueta}>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{dato.etiqueta}</dt>
              <dd className="m-0 mt-0.5 text-sm text-ink">{dato.valor}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card como="section" className="mt-3">
        <h2 className="mb-3 mt-0 text-base font-semibold text-ink">
          Evidencias
          {detalle.evidencias_adjuntas.length > 0 && (
            <span className="ml-2 text-sm font-normal text-muted">({detalle.evidencias_adjuntas.length})</span>
          )}
        </h2>
        <GaleriaEvidencias incidenciaId={detalle._id} evidencias={detalle.evidencias_adjuntas} />
      </Card>

      <Card como="section" className="mt-3">
        <h2 className="mb-3 mt-0 text-base font-semibold text-ink">Bitácora</h2>
        <Timeline
          entradas={detalle.historial_seguimiento}
          reportante={detalle.reportante}
          tecnico={detalle.tecnico_asignado}
        />
      </Card>

      <FormSeguimiento
        incidenciaId={detalle._id}
        estadoActual={detalle.estado}
        puedeRegistrar={usuario?.permisos.includes('seguimiento:registrar') ?? false}
        puedeCerrar={usuario?.permisos.includes('incidencias:asignar') ?? false}
        onSeguimientoGuardado={() => void refetch()}
      />

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
