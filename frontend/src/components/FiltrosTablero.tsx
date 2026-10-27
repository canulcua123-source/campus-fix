import { useQuery } from '@tanstack/react-query'
import { useTecnicos } from '../api/hooks/admin'
import { ubicacionesAulaQuery } from '../api/aulas'
import { ESTADOS, PRIORIDADES, type FiltrosIncidencias } from '../schemas/incidencia'
import { Building, X } from 'lucide-react'
import { BarraFiltros, Button, ETIQUETAS, Select } from './ui'

export type FiltrosTableroValor = Pick<FiltrosIncidencias, 'estado' | 'prioridad' | 'edificio' | 'tecnico'>
type Campo = keyof FiltrosTableroValor

interface FiltrosTableroProps {
  filtros: FiltrosTableroValor
  onCambiar: (campo: Campo, valor: string | undefined) => void
  onLimpiar: () => void
  /** Edificios vistos en las incidencias cargadas (pueden no estar en el catálogo de aulas). */
  edificiosExtra?: readonly string[]
}

/** Filtros combinables del tablero; el valor vive en la URL y se manda al backend (no se filtra en cliente). */
export function FiltrosTablero({ filtros, onCambiar, onLimpiar, edificiosExtra = [] }: FiltrosTableroProps) {
  const tecnicos = useTecnicos()
  const catalogo = useQuery({ ...ubicacionesAulaQuery(), retry: false })
  // Catálogo de aulas + edificios presentes en las incidencias + el valor actual de la URL, sin repetir.
  const edificios = [...new Set([
    ...(catalogo.data ?? []).map((u) => u.edificio),
    ...edificiosExtra,
    ...(filtros.edificio ? [filtros.edificio] : []),
  ].filter(Boolean))].sort((x, y) => x.localeCompare(y, 'es', { numeric: true }))
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
      <Select
        tamano="sm"
        etiqueta="Edificio"
        icono={<Building size={16} />}
        placeholder="Todos"
        value={filtros.edificio ?? ''}
        opciones={edificios.map((e) => ({ valor: e, texto: e.length <= 2 ? `Edificio ${e}` : e }))}
        onChange={(e) => onCambiar('edificio', e.target.value || undefined)}
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
