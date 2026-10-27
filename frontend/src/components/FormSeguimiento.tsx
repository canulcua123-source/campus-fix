import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { ApiError } from '../api/client'
import { useSeguimiento } from '../api/hooks/incidencias'
import { seguimientoSchema, type SeguimientoIn } from '../schemas/incidencia'
import { etiquetaEstado, transicionesDesde, type Estado } from '../lib/estados'
import clsx from 'clsx'
import { ArrowRight, ClipboardPen } from 'lucide-react'
import { Badge, BottomSheet, Button, Input, Textarea } from './ui'

interface FormSeguimientoProps {
  incidenciaId: string
  estadoActual: Estado
  puedeCerrar: boolean
  puedeRegistrar: boolean
  /** Se llama con el estado al que pasó la incidencia, para avisar qué ocurre después. */
  onSeguimientoGuardado?: (estadoNuevo: Estado) => void
}

/** Qué significa cada destino y qué pasa después (tabla 9.4). */
function OPCION_ESTADO(actual: Estado, destino: Estado): { titulo: string; descripcion: string } {
  switch (destino) {
    case 'en_proceso':
      return actual === 'resuelta'
        ? { titulo: 'Reabrir · En proceso', descripcion: 'El problema sigue. Vuelve a tus pendientes.' }
        : { titulo: 'En proceso', descripcion: 'Estás trabajando en ella. El reportante ve que ya se atiende.' }
    case 'en_espera':
      return { titulo: 'En espera', descripcion: 'Falta algo para seguir (pieza, acceso o información). El reportante podrá agregar datos.' }
    case 'resuelta':
      return { titulo: 'Resuelta', descripcion: 'Ya quedó. El reportante tiene 7 días para confirmarla o reabrirla.' }
    case 'cerrada':
      return { titulo: 'Cerrar', descripcion: 'Cierre definitivo: ya no admite cambios.' }
    default:
      return { titulo: etiquetaEstado(destino), descripcion: '' }
  }
}

const AYUDA_COMENTARIO: Partial<Record<Estado, string>> = {
  en_proceso: 'Describe qué estás haciendo o qué revisaste.',
  en_espera: 'Indica qué falta y quién debe darlo; el reportante lo verá.',
  resuelta: 'Explica qué solucionaste; el reportante lo verá al confirmar.',
  cerrada: 'Motivo del cierre.',
}

/** Hoja para registrar una transición de estado y su bitácora. En móvil el botón queda fijo sobre la barra inferior. */
export function FormSeguimiento({
  incidenciaId,
  estadoActual,
  puedeCerrar,
  puedeRegistrar,
  onSeguimientoGuardado,
}: FormSeguimientoProps) {
  const [abierto, setAbierto] = useState(false)
  const [mensajeError, setMensajeError] = useState<string | null>(null)
  const seguimiento = useSeguimiento(incidenciaId)
  const transiciones = transicionesDesde(estadoActual).filter((estado) => estado !== 'cerrada' || puedeCerrar)
  const form = useForm<SeguimientoIn>({
    resolver: zodResolver(seguimientoSchema),
    mode: 'onTouched',
    defaultValues: { comentario: '', horas: 0, estado_nuevo: transiciones[0] },
  })
  const estadoElegido = useWatch({ control: form.control, name: 'estado_nuevo' })

  // Al cambiar el estado de la incidencia (p. ej. tras guardar y refrescar) el formulario vuelve a su valor inicial válido.
  const primeraTransicion = transiciones[0]
  const { reset } = form
  useEffect(() => {
    reset({ comentario: '', horas: 0, estado_nuevo: primeraTransicion })
  }, [reset, primeraTransicion])

  if (!puedeRegistrar || transiciones.length === 0) return null

  const cerrar = () => {
    if (seguimiento.isPending) return
    form.reset({ comentario: '', horas: 0, estado_nuevo: transiciones[0] })
    setMensajeError(null)
    setAbierto(false)
  }

  const enviar = form.handleSubmit(async (datos) => {
    setMensajeError(null)
    try {
      await seguimiento.mutateAsync(datos)
      cerrar()
      onSeguimientoGuardado?.(datos.estado_nuevo)
    } catch (error) {
      setMensajeError(
        error instanceof ApiError && error.status === 409
          ? 'El estado cambió mientras registrabas el seguimiento. Actualiza la incidencia e inténtalo de nuevo.'
          : error instanceof ApiError
            ? error.mensaje
            : 'No se pudo registrar el seguimiento. Inténtalo de nuevo.',
      )
    }
  })

  return (
    <section aria-label="Acciones de seguimiento">
      <div
        data-barra-fija
        className="max-lg:fixed max-lg:inset-x-0 max-lg:z-20 max-lg:border-t max-lg:border-line max-lg:bg-panel max-lg:px-4 max-lg:py-2"
        style={{ bottom: 'calc(var(--tabbar-height) + var(--safe-bottom))' }}
      >
        <Button bloque icono={<ClipboardPen size={18} />} onClick={() => setAbierto(true)}>Registrar seguimiento</Button>
      </div>
      <BottomSheet abierto={abierto} onCerrar={cerrar} titulo="Registrar seguimiento">
        <form id="form-seguimiento" className="flex flex-col gap-4" onSubmit={enviar} noValidate>
          {mensajeError && <p className="m-0 ui-campo__error" role="alert">{mensajeError}</p>}
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="ui-campo__etiqueta mb-1.5">¿Cómo queda la incidencia?</legend>
            <p className="m-0 flex items-center gap-2 text-sm text-muted">
              Ahora <Badge tipo="estado" valor={estadoActual} />
              {estadoElegido && <><ArrowRight size={14} aria-hidden /> pasará a <Badge tipo="estado" valor={estadoElegido} /></>}
            </p>
            {transiciones.map((estado) => {
              const info = OPCION_ESTADO(estadoActual, estado)
              const elegido = estadoElegido === estado
              return (
                <label
                  key={estado}
                  className={clsx(
                    'flex cursor-pointer items-start gap-3 rounded-input border p-3 transition-colors',
                    elegido ? 'border-brand bg-panel-2' : 'border-line hover:border-line-input',
                  )}
                >
                  <input type="radio" value={estado} className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-primary)]" {...form.register('estado_nuevo')} />
                  <span className="flex flex-col gap-0.5">
                    <span className="font-semibold">{info.titulo}</span>
                    <span className="text-sm text-muted">{info.descripcion}</span>
                  </span>
                </label>
              )
            })}
            {form.formState.errors.estado_nuevo?.message && (
              <p className="m-0 ui-campo__error" role="alert">{form.formState.errors.estado_nuevo.message}</p>
            )}
          </fieldset>
          <Input
            etiqueta="Horas invertidas"
            ayuda="De 0 a 24 horas; usa decimales (1.5 = hora y media)."
            type="number"
            min="0"
            max="24"
            step="0.25"
            inputMode="decimal"
            error={form.formState.errors.horas?.message}
            required
            {...form.register('horas', { valueAsNumber: true })}
          />
          <Textarea
            etiqueta="Comentario"
            ayuda={estadoElegido ? AYUDA_COMENTARIO[estadoElegido] : 'Describe el trabajo realizado.'}
            rows={4}
            maxLength={1000}
            error={form.formState.errors.comentario?.message}
            required
            {...form.register('comentario')}
          />
        </form>
        <div className="ui-sheet__acciones">
          <Button variante="secundario" onClick={cerrar} disabled={seguimiento.isPending}>Cancelar</Button>
          <Button type="submit" form="form-seguimiento" cargando={seguimiento.isPending} textoCargando="Guardando…">
            Guardar seguimiento
          </Button>
        </div>
      </BottomSheet>
    </section>
  )
}
