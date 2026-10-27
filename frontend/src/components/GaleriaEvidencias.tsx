import { ExternalLink, FileText, ImageOff, Image as ImageIcon, RefreshCw, Video } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useUrlEvidencia } from '../api/hooks/incidencias'
import type { EvidenciaAdjunta } from '../schemas/incidencia'
import { esImagen, esVideo, formatearFecha } from '../lib/detalle'
import { BottomSheet, Button, EmptyState, ErrorState, Skeleton } from './ui'

interface GaleriaEvidenciasProps {
  incidenciaId: string
  evidencias: readonly EvidenciaAdjunta[]
}

export function GaleriaEvidencias({ incidenciaId, evidencias }: GaleriaEvidenciasProps) {
  const [activa, setActiva] = useState<EvidenciaAdjunta | null>(null)

  if (evidencias.length === 0) {
    return (
      <EmptyState
        titulo="Sin evidencias"
        descripcion="Aún no se han adjuntado fotos, videos ni documentos a esta incidencia."
        icono={ImageOff}
      />
    )
  }

  return (
    <>
      <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3">
        {evidencias.map((evidencia) => (
          <li key={evidencia.evidencia_id}>
            <button
              type="button"
              onClick={() => setActiva(evidencia)}
              className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-input border border-line bg-panel-2 p-3 text-center text-ink"
              aria-label={`Ver ${evidencia.nombre_archivo}`}
            >
              {esImagen(evidencia.tipo_mime)
                ? <ImageIcon size={26} aria-hidden className="text-brand" />
                : esVideo(evidencia.tipo_mime)
                  ? <Video size={26} aria-hidden className="text-brand" />
                  : <FileText size={26} aria-hidden className="text-brand" />}
              <span className="line-clamp-2 text-xs font-semibold">{evidencia.nombre_archivo}</span>
              <span className="text-xs text-muted">{evidencia.peso_kb} KB</span>
            </button>
          </li>
        ))}
      </ul>
      <BottomSheet abierto={activa !== null} onCerrar={() => setActiva(null)} titulo={activa?.nombre_archivo ?? 'Evidencia'}>
        {activa && (
          <VisorEvidencia
            key={activa.evidencia_id}
            incidenciaId={incidenciaId}
            evidencia={activa}
          />
        )}
      </BottomSheet>
    </>
  )
}

function VisorEvidencia({ incidenciaId, evidencia }: { incidenciaId: string; evidencia: EvidenciaAdjunta }) {
  const { data, isPending, isError, isFetching, refetch } = useUrlEvidencia(incidenciaId, evidencia.evidencia_id)
  const [renovado, setRenovado] = useState(false)

  useEffect(() => {
    if (!data) return
    const margen = Math.max(5, data.expira_en - 15) * 1000
    const temporizador = setTimeout(() => void refetch(), margen)
    return () => clearTimeout(temporizador)
  }, [data, refetch])

  if (isPending) {
    return (
      <div role="status" aria-label="Cargando evidencia." className="flex flex-col gap-3">
        <Skeleton alto={180} />
        <Skeleton ancho="60%" alto={14} />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <ErrorState
        titulo="No pudimos abrir la evidencia"
        mensaje="El enlace pudo vencer o el archivo ya no está disponible."
        onReintentar={() => void refetch()}
        reintentando={isFetching}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {esImagen(evidencia.tipo_mime) ? (
        <img
          src={data.url}
          alt={evidencia.nombre_archivo}
          className="max-h-[55dvh] w-full rounded-input bg-panel-2 object-contain"
          onError={() => {
            if (renovado) return
            setRenovado(true)
            void refetch()
          }}
        />
      ) : esVideo(evidencia.tipo_mime) ? (
        <video
          src={data.url}
          controls
          playsInline
          preload="metadata"
          aria-label={evidencia.nombre_archivo}
          className="max-h-[55dvh] w-full rounded-input bg-panel-2"
          onError={() => {
            if (renovado) return
            setRenovado(true)
            void refetch()
          }}
        />
      ) : (
        <Button icono={<ExternalLink size={18} />} onClick={() => window.open(data.url, '_blank', 'noopener,noreferrer')}>
          Abrir PDF en una pestaña
        </Button>
      )}
      <p className="m-0 text-sm text-muted">
        {evidencia.nombre_archivo} · {evidencia.peso_kb} KB · {formatearFecha(evidencia.fecha_carga)}
      </p>
      <Button
        variante="fantasma"
        icono={<RefreshCw size={18} />}
        cargando={isFetching}
        textoCargando="Renovando."
        onClick={() => void refetch()}
      >
        Renovar enlace
      </Button>
    </div>
  )
}
