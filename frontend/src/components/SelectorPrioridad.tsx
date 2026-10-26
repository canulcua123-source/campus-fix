import { useState } from 'react'
import { ApiError } from '../api/client'
import { usePrioridad } from '../api/hooks/incidencias'
import { PRIORIDADES, type Prioridad } from '../schemas/incidencia'
import { Button, ETIQUETAS, Select } from './ui'

interface SelectorPrioridadProps {
  incidenciaId: string
  prioridad: Prioridad
}

function mensajeDeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return 'Esta incidencia ya no está disponible o no está dentro de tu alcance.'
    if (error.status === 403) return 'No tienes permiso para cambiar la prioridad.'
    if (error.status === 409) return 'La incidencia cambió. Revisa el detalle actualizado e intenta de nuevo.'
    return error.mensaje
  }
  return 'No pudimos cambiar la prioridad. Intenta de nuevo.'
}

/** T-052b: el coordinador ajusta la prioridad; la API valida permiso, alcance y estado y lo anota en la bitácora. */
export function SelectorPrioridad({ incidenciaId, prioridad }: SelectorPrioridadProps) {
  const mutacion = usePrioridad(incidenciaId)
  const [elegida, setElegida] = useState<Prioridad>(prioridad)
  const [actual, setActual] = useState(prioridad)
  // Si el detalle se refresca con otra prioridad, el selector la adopta.
  if (actual !== prioridad) {
    setActual(prioridad)
    setElegida(prioridad)
  }

  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
      onSubmit={(e) => {
        e.preventDefault()
        if (elegida !== prioridad) mutacion.mutate({ prioridad: elegida })
      }}
    >
      <div className="sm:flex-1">
        <Select
          etiqueta="Prioridad"
          value={elegida}
          disabled={mutacion.isPending}
          opciones={PRIORIDADES.map((p) => ({ valor: p, texto: ETIQUETAS.prioridad[p] }))}
          onChange={(e) => {
            mutacion.reset()
            setElegida(e.target.value as Prioridad)
          }}
        />
      </div>
      <Button type="submit" disabled={elegida === prioridad} cargando={mutacion.isPending} textoCargando="Guardando…">
        Guardar prioridad
      </Button>
      {mutacion.isSuccess && (
        <p role="status" className="m-0 text-sm text-ok sm:basis-full">Prioridad actualizada.</p>
      )}
      {mutacion.isError && (
        <p role="alert" className="m-0 text-sm text-bad sm:basis-full">{mensajeDeError(mutacion.error)}</p>
      )}
    </form>
  )
}
