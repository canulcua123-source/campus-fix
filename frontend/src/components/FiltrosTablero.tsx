import { useState } from 'react'
import { useTecnicos } from '../api/hooks/admin'
import { ESTADOS, PRIORIDADES, type FiltrosIncidencias } from '../schemas/incidencia'
import { Button, ETIQUETAS, Input, Select } from './ui'

export type FiltrosTableroValor = Pick<FiltrosIncidencias, 'estado' | 'prioridad' | 'edificio' | 'tecnico'>
type Campo = keyof FiltrosTableroValor

interface FiltrosTableroProps {
  filtros: FiltrosTableroValor
  onCambiar: (campo: Campo, valor: string | undefined) => void
  onLimpiar: () => void
}

/** Filtros combinables del tablero; el valor vive en la URL y se manda al backend (no se filtra en cliente). */
export function FiltrosTablero({ filtros, onCambiar, onLimpiar }: FiltrosTableroProps) {
  const tecnicos = useTecnicos()
  // El edificio se aplica al salir del campo o con Enter, no en cada tecla.
  const [edificio, setEdificio] = useState(filtros.edificio ?? '')
  const [edificioUrl, setEdificioUrl] = useState(filtros.edificio)
  if (edificioUrl !== filtros.edificio) {
    setEdificioUrl(filtros.edificio)
    setEdificio(filtros.edificio ?? '')
  }
  const aplicarEdificio = () => onCambiar('edificio', edificio.trim() || undefined)
  const hayFiltros = Object.values(filtros).some(Boolean)

  return (
    <section aria-label="Filtros del tablero" className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Select
        etiqueta="Estado"
        placeholder="Todos"
        value={filtros.estado ?? ''}
        opciones={ESTADOS.map((e) => ({ valor: e, texto: ETIQUETAS.estado[e] }))}
        onChange={(e) => onCambiar('estado', e.target.value || undefined)}
      />
      <Select
        etiqueta="Prioridad"
        placeholder="Todas"
        value={filtros.prioridad ?? ''}
        opciones={PRIORIDADES.map((p) => ({ valor: p, texto: ETIQUETAS.prioridad[p] }))}
        onChange={(e) => onCambiar('prioridad', e.target.value || undefined)}
      />
      <Input
        etiqueta="Edificio"
        placeholder="Ej. Edificio A"
        maxLength={60}
        value={edificio}
        onChange={(e) => setEdificio(e.target.value)}
        onBlur={aplicarEdificio}
        onKeyDown={(e) => {
          if (e.key === 'Enter') aplicarEdificio()
        }}
      />
      <Select
        etiqueta="Técnico"
        placeholder={tecnicos.isError ? 'Todos (no se pudo cargar la lista)' : 'Todos'}
        value={filtros.tecnico ?? ''}
        opciones={[
          { valor: 'sin_asignar', texto: 'Sin asignar' },
          ...(tecnicos.data ?? []).map((t) => ({ valor: t._id, texto: t.nombre })),
        ]}
        onChange={(e) => onCambiar('tecnico', e.target.value || undefined)}
      />
      {hayFiltros && (
        <div className="sm:col-span-2 lg:col-span-4">
          <Button variante="fantasma" onClick={onLimpiar}>Limpiar filtros</Button>
        </div>
      )}
    </section>
  )
}
