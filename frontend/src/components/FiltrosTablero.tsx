import { useState } from 'react'
import { useTecnicos } from '../api/hooks/admin'
import { ESTADOS, PRIORIDADES, type FiltrosIncidencias } from '../schemas/incidencia'
import { Building, X } from 'lucide-react'
import { BarraFiltros, Button, ETIQUETAS, Input, Select } from './ui'

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
  const activos = Object.values(filtros).filter(Boolean).length

  return (
    <BarraFiltros
      etiqueta="Filtros del tablero"
      activos={activos}
      acciones={activos > 0 ? (
        <Button variante="fantasma" tamano="sm" icono={<X size={16} />} onClick={onLimpiar}>Limpiar filtros</Button>
      ) : undefined}
    >
      <Select
        tamano="sm"
        etiqueta="Estado"
        placeholder="Todos"
        value={filtros.estado ?? ''}
        opciones={ESTADOS.map((e) => ({ valor: e, texto: ETIQUETAS.estado[e] }))}
        onChange={(e) => onCambiar('estado', e.target.value || undefined)}
      />
      <Select
        tamano="sm"
        etiqueta="Prioridad"
        placeholder="Todas"
        value={filtros.prioridad ?? ''}
        opciones={PRIORIDADES.map((p) => ({ valor: p, texto: ETIQUETAS.prioridad[p] }))}
        onChange={(e) => onCambiar('prioridad', e.target.value || undefined)}
      />
      <Input
        tamano="sm"
        etiqueta="Edificio"
        icono={<Building size={16} />}
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
        tamano="sm"
        etiqueta="Técnico"
        placeholder={tecnicos.isError ? 'Todos (no se pudo cargar la lista)' : 'Todos'}
        value={filtros.tecnico ?? ''}
        opciones={[
          { valor: 'sin_asignar', texto: 'Sin asignar' },
          ...(tecnicos.data ?? []).map((t) => ({ valor: t._id, texto: t.nombre })),
        ]}
        onChange={(e) => onCambiar('tecnico', e.target.value || undefined)}
      />
    </BarraFiltros>
  )
}
