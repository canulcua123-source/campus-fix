import { useState } from 'react'
import { mensajeDeError } from '../api/client'
import { useTecnicos } from '../api/hooks/admin'
import { useAsignar } from '../api/hooks/incidencias'
import type { IncidenciaListaItem } from '../schemas/incidencia'
import { BottomSheet, Button, ErrorState, Skeleton } from './ui'

interface SelectorTecnicoProps {
  incidencia: IncidenciaListaItem
  onCerrar: () => void
  onAsignado: (nombre: string) => void
}

/** Hoja para asignar o reasignar: lista solo técnicos activos del área de la incidencia (GET /usuarios/tecnicos?area=). */
export function SelectorTecnico({ incidencia, onCerrar, onAsignado }: SelectorTecnicoProps) {
  const tecnicos = useTecnicos(incidencia.categoria)
  const asignar = useAsignar(incidencia._id)
  const actual = incidencia.tecnico_asignado?.usuario_id
  const [elegido, setElegido] = useState(actual ?? '')
  const reasignar = Boolean(actual)
  const cerrar = () => {
    if (!asignar.isPending) onCerrar()
  }

  const confirmar = () => {
    const tecnico = tecnicos.data?.find((t) => t._id === elegido)
    if (!tecnico) return
    asignar.mutate({ tecnico_id: tecnico._id }, { onSuccess: () => onAsignado(tecnico.nombre) })
  }

  return (
    <BottomSheet
      abierto
      onCerrar={cerrar}
      titulo={reasignar ? 'Reasignar técnico' : 'Asignar técnico'}
      acciones={(
        <>
          <Button variante="secundario" disabled={asignar.isPending} onClick={cerrar}>Cancelar</Button>
          <Button
            cargando={asignar.isPending}
            textoCargando="Asignando…"
            disabled={!elegido || elegido === actual}
            onClick={confirmar}
          >
            {reasignar ? 'Reasignar' : 'Asignar'}
          </Button>
        </>
      )}
    >
      <p className="mb-3 mt-0 text-sm text-muted">{incidencia.codigo} · {incidencia.titulo}</p>

      {tecnicos.isPending && (
        <div role="status" aria-label="Cargando técnicos" className="flex flex-col gap-2">
          <Skeleton alto={44} />
          <Skeleton alto={44} />
        </div>
      )}
      {tecnicos.isError && (
        <ErrorState
          titulo="No pudimos cargar los técnicos"
          mensaje={mensajeDeError(tecnicos.error, 'Revisa tu conexión e intenta de nuevo.')}
          onReintentar={() => void tecnicos.refetch()}
          reintentando={tecnicos.isFetching}
        />
      )}
      {tecnicos.data?.length === 0 && (
        <p className="m-0 text-sm text-muted">No hay técnicos activos en el área de esta incidencia.</p>
      )}
      {tecnicos.data && tecnicos.data.length > 0 && (
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 text-sm font-semibold text-ink">Técnicos del área</legend>
          {tecnicos.data.map((t) => (
            <label key={t._id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-input border border-line bg-panel px-3">
              <input
                type="radio"
                name="tecnico"
                value={t._id}
                checked={elegido === t._id}
                onChange={() => setElegido(t._id)}
              />
              <span className="text-ink">{t.nombre}</span>
              {t._id === actual && <span className="ml-auto text-xs text-muted">Asignado</span>}
            </label>
          ))}
        </fieldset>
      )}

      {asignar.isError && (
        <p role="alert" className="mb-0 mt-3 text-sm text-bad">{mensajeDeError(asignar.error, 'No se pudo asignar')}</p>
      )}
    </BottomSheet>
  )
}
