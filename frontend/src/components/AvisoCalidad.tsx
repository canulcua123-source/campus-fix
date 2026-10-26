import { Camera } from 'lucide-react'
import { describirCalidad, type CalidadCliente } from '../lib/calidad'
import { Button, Card } from './ui'

interface AvisoCalidadProps {
  pistas: readonly CalidadCliente[]
  onRepetir: () => void
  onUsar: () => void
}

/** Aviso NO bloqueante del control de calidad (T-051): el formulario sigue editable mientras se decide. */
export function AvisoCalidad({ pistas, onRepetir, onUsar }: AvisoCalidadProps) {
  return (
    <Card role="alert" className="mb-3 text-sm">
      <p className="m-0 font-semibold">{describirCalidad(pistas)}</p>
      <p className="mb-3 mt-1 text-muted">
        Una foto clara ayuda a que la IA y el técnico entiendan el problema. Puedes repetirla o continuar con esta.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button icono={<Camera size={18} aria-hidden />} onClick={onRepetir}>Repetir</Button>
        <Button variante="secundario" onClick={onUsar}>Usar de todos modos</Button>
      </div>
    </Card>
  )
}
