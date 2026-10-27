import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { ApiError } from '../api/client'
import { useSeguimiento } from '../api/hooks/incidencias'
import { seguimientoSchema, type SeguimientoIn } from '../schemas/incidencia'
import { etiquetaEstado, transicionesDesde, type Estado } from '../lib/estados'
import { ClipboardPen } from 'lucide-react'
import { BottomSheet, Button, Input, Segmentado, Textarea } from './ui'

interface FormSeguimientoProps {
  incidenciaId: string
  estadoActual: Estado
  puedeCerrar: boolean
  puedeRegistrar: boolean
  onSeguimientoGuardado?: () => void
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
      onSeguimientoGuardado?.()
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
          <div className="flex flex-col gap-1.5">
            <span className="ui-campo__etiqueta">
              Nuevo estado <span className="font-normal text-muted">· ahora {etiquetaEstado(estadoActual)}</span>
            </span>
            <Segmentado
              etiqueta="Nuevo estado"
              valor={estadoElegido ?? ''}
              onCambio={(v) => form.setValue('estado_nuevo', v as SeguimientoIn['estado_nuevo'], { shouldValidate: true })}
              opciones={transiciones.map((estado) => ({ valor: estado, texto: etiquetaEstado(estado) }))}
              className="flex w-full [&>button]:flex-1"
            />
            {form.formState.errors.estado_nuevo?.message && (
              <p className="m-0 ui-campo__error" role="alert">{form.formState.errors.estado_nuevo.message}</p>
            )}
          </div>
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
            ayuda="Describe el trabajo realizado."
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
