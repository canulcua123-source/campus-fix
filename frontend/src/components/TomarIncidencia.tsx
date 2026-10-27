import { mensajeDeError } from '../api/client'
import { useTomar } from '../api/hooks/incidencias'
import { Hand } from 'lucide-react'
import { Button, Card } from './ui'

interface Props {
  incidenciaId: string
  onHecho: (mensaje: string) => void
}

/** Técnico: se autoasigna una incidencia sin técnico. Si otro la tomó antes (409) se muestra el motivo y se refrescan los datos. */
export function TomarIncidencia({ incidenciaId, onHecho }: Props) {
  const tomar = useTomar()
  return (
    <Card como="section" className="flex flex-col gap-3 border-brand">
      <div className="flex items-start gap-3">
        <span aria-hidden className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-panel-2 text-brand">
          <Hand size={18} />
        </span>
        <div>
          <h2 className="m-0 text-base font-semibold text-ink">Sin técnico asignado</h2>
          <p className="m-0 mt-0.5 text-sm text-muted">Puedes tomar esta incidencia para atenderla tú.</p>
        </div>
      </div>
      {tomar.isError && (
        <p role="alert" className="m-0 rounded-input border border-bad p-3 text-sm text-bad">
          {mensajeDeError(tomar.error, 'No pudimos asignarte la incidencia. Intenta de nuevo.')}
        </p>
      )}
      <Button
        bloque
        cargando={tomar.isPending}
        textoCargando="Tomando…"
        onClick={() => tomar.mutate(incidenciaId, { onSuccess: () => onHecho('Tomaste la incidencia. Ya aparece en tus asignadas.') })}
      >
        Tomar incidencia
      </Button>
    </Card>
  )
}
