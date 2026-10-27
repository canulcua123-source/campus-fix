import { CircleHelp, CircleX, Sparkles, TriangleAlert } from 'lucide-react'
import type { ComponentType } from 'react'
import type { RespuestaIA } from '../schemas/ia'

const PRESENTACION: Record<RespuestaIA['accion_asistida'], { etiqueta: string; Icono: ComponentType<{ 'aria-hidden': true }> }> = {
  autollenar: { etiqueta: 'Formulario completado por IA', Icono: Sparkles },
  sugerir: { etiqueta: 'Sugerencia de IA', Icono: TriangleAlert },
  preguntar: { etiqueta: 'Necesitamos tu ayuda', Icono: CircleHelp },
  rechazar: { etiqueta: 'Foto no reconocida', Icono: CircleX },
}

export function SugerenciaIA({ respuesta }: { respuesta: RespuestaIA }) {
  const { etiqueta, Icono } = PRESENTACION[respuesta.accion_asistida]

  return (
    <section className="card mb-3 text-sm" role="status" aria-label={etiqueta}>
      <p className="m-0 flex items-center gap-2 font-semibold text-ink">
        <Icono aria-hidden /> {etiqueta}
      </p>
      <p className="mb-0 mt-2 text-muted">{respuesta.mensaje}</p>
    </section>
  )
}
