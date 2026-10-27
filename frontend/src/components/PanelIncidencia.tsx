import { ExternalLink } from 'lucide-react'
import { useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { VistaDetalleIncidencia } from '../pages/DetalleIncidencia'
import { PanelLateral } from './ui'

/**
 * Detalle de incidencia en panel lateral controlado por `?ver=<id>` en la URL:
 * «Atrás» del navegador lo cierra y el enlace se puede compartir.
 */
export function usePanelIncidencia() {
  const [params, setParams] = useSearchParams()
  const id = params.get('ver')

  const abrir = useCallback((nuevo: string) => {
    setParams((previos) => { const p = new URLSearchParams(previos); p.set('ver', nuevo); return p })
  }, [setParams])

  const cerrar = useCallback(() => {
    setParams((previos) => { const p = new URLSearchParams(previos); p.delete('ver'); return p }, { replace: true })
  }, [setParams])

  const panel = (
    <PanelLateral
      abierto={Boolean(id)}
      onCerrar={cerrar}
      titulo="Detalle de incidencia"
      acciones={id ? (
        <Link to={`/incidencias/${encodeURIComponent(id)}`} className="ui-btn ui-btn--fantasma ui-btn--sm" aria-label="Abrir en página completa" title="Abrir en página completa">
          <ExternalLink size={18} aria-hidden />
        </Link>
      ) : null}
    >
      {id && <VistaDetalleIncidencia id={id} enPanel />}
    </PanelLateral>
  )

  return { abrir, cerrar, panel, abiertoId: id }
}
