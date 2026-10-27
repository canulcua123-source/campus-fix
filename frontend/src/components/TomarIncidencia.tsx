import { mensajeDeError } from '../api/client'
import { useTomar } from '../api/hooks/incidencias'
import { Button, Card } from './ui'

interface Props {
  incidenciaId: string
  onHecho: (mensaje: string) => void
}

/** Técnico: se autoasigna una incidencia sin técnico. Si otro la tomó antes (409) se muestra el motivo y se refrescan los datos. */
export function TomarIncidencia({ incidenciaId, onHecho }: Props) {
  const tomar = useTomar()
  return (
    <Card como="section" className="mb-3">
      <h2 className="mb-1 mt-0 text-base font-semibold text-ink">Sin técnico asignado</h2>
      <p className="mb-3 mt-0 text-sm text-muted">Puedes tomar esta incidencia para atenderla tú.</p>
      {tomar.isError && (
        <p role="alert" className="mb-3 mt-0 rounded-input border border-bad p-3 text-sm text-bad">
          {mensajeDeError(tomar.error, 'No pudimos asignarte la incidencia. Intenta de nuevo.')}
        </p>
      )}
      <Button
        cargando={tomar.isPending}
        textoCargando="Tomando…"
        onClick={() => tomar.mutate(incidenciaId, { onSuccess: () => onHecho('Tomaste la incidencia. Ya aparece en tus asignadas.') })}
      >
        Tomar incidencia
      </Button>
    </Card>
  )
}
