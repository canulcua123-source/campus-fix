import clsx from 'clsx'
import { useState } from 'react'
import { hoyEnMexico, rangoUltimosDias } from '../../lib/fechas'
import { Input, type TamanoCampo } from './Campo'
import { Segmentado } from './Segmentado'

export interface ValorRango {
  /** "YYYY-MM-DD" en America/Mexico_City. */
  desde?: string
  hasta?: string
}

type Preset = 'todo' | '7' | '30' | '90' | 'personalizado'

interface RangoFechasProps {
  valor: ValorRango
  onCambio: (v: ValorRango) => void
  /** Nombre del grupo (lectores de pantalla y leyenda visible). */
  etiqueta?: string
  /** Agrega la opción "Todo" (sin rango: {}). */
  permitirTodo?: boolean
  /** Días de los atajos. Por defecto 7, 30 y 90. */
  presets?: (7 | 30 | 90)[]
  tamano?: TamanoCampo
}

function presetDe(v: ValorRango, presets: number[], permitirTodo: boolean): Preset {
  if (!v.desde && !v.hasta) return permitirTodo ? 'todo' : 'personalizado'
  for (const n of presets) {
    const r = rangoUltimosDias(n)
    if (r.desde === v.desde && r.hasta === v.hasta) return String(n) as Preset
  }
  return 'personalizado'
}

/** Periodo con atajos (7 / 30 / 90 días / Personalizado); "Personalizado" muestra Desde/Hasta. Fechas YYYY-MM-DD en hora de México. */
export function RangoFechas({
  valor, onCambio, etiqueta = 'Periodo', permitirTodo = false, presets = [7, 30, 90], tamano = 'sm',
}: RangoFechasProps) {
  const [modo, setModo] = useState<Preset>(() => presetDe(valor, presets, permitirTodo))
  const hoy = hoyEnMexico()

  const elegir = (p: Preset) => {
    setModo(p)
    if (p === 'todo') onCambio({})
    else if (p !== 'personalizado') onCambio(rangoUltimosDias(Number(p)))
  }

  return (
    <fieldset className={clsx('ui-rango', tamano === 'sm' && 'ui-rango--sm')}>
      <legend className="ui-campo__etiqueta ui-rango__leyenda">{etiqueta}</legend>
      <Segmentado
        etiqueta={`Atajos de ${etiqueta.toLowerCase()}`}
        valor={modo}
        onCambio={elegir}
        tamano={tamano}
        opciones={[
          ...(permitirTodo ? [{ valor: 'todo' as Preset, texto: 'Todo' }] : []),
          ...presets.map((n) => ({ valor: String(n) as Preset, texto: `${n} días` })),
          { valor: 'personalizado' as Preset, texto: 'Personalizado' },
        ]}
      />
      {modo === 'personalizado' && (
        <div className="ui-rango__fechas">
          <Input
            etiqueta="Desde" type="date" tamano={tamano} value={valor.desde ?? ''}
            max={valor.hasta || hoy} onChange={(e) => onCambio({ ...valor, desde: e.target.value || undefined })}
          />
          <Input
            etiqueta="Hasta" type="date" tamano={tamano} value={valor.hasta ?? ''}
            min={valor.desde || undefined} max={hoy} onChange={(e) => onCambio({ ...valor, hasta: e.target.value || undefined })}
          />
        </div>
      )}
    </fieldset>
  )
}
