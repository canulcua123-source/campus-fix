import { useQuery } from '@tanstack/react-query'
import { MapPin } from 'lucide-react'
import { useState } from 'react'
import { useWatch, type Control, type FieldErrors, type UseFormRegister, type UseFormSetValue } from 'react-hook-form'
import { ubicacionesAulaQuery } from '../api/aulas'
import type { IncidenciaForm } from '../schemas/incidencia'
import { Button, Input, Select } from './ui'

const OTRO = '__otro__'
const textoPiso = (piso: number) => (piso === 0 ? 'Planta baja' : piso < 0 ? `Sótano ${-piso}` : `Piso ${piso}`)
const unicos = <T,>(valores: T[]) => [...new Set(valores)]

interface Props {
  control: Control<IncidenciaForm>
  register: UseFormRegister<IncidenciaForm>
  setValue: UseFormSetValue<IncidenciaForm>
  errors: FieldErrors<IncidenciaForm>
  /** Ubicación fijada por QR: campos de solo lectura. */
  fijada: boolean
}

/** Edificio → piso → aula desde el catálogo; «Otro lugar» o un catálogo vacío pasan a captura libre. */
export function SelectorUbicacion({ control, register, setValue, errors, fijada }: Props) {
  const catalogo = useQuery({ ...ubicacionesAulaQuery(), enabled: !fijada })
  const [manual, setManual] = useState(false)
  const { edificio, piso, aula } = useWatch({ control, name: 'ubicacion' })
  const ubicaciones = catalogo.data ?? []
  const sinCatalogo = catalogo.isError || (catalogo.isSuccess && ubicaciones.length === 0)
  const fijar = (campo: 'edificio' | 'piso' | 'aula', valor: string | number | null) =>
    setValue(`ubicacion.${campo}`, valor as never, { shouldValidate: true, shouldDirty: true })

  if (fijada || manual || sinCatalogo) {
    return (
      <div className="pila pila--sm">
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
          <Input etiqueta="Edificio" icono={<MapPin size={18} />} readOnly={fijada} aria-readonly={fijada}
            error={errors.ubicacion?.edificio?.message} {...register('ubicacion.edificio')} />
          <Input etiqueta="Piso (opcional)" type="number" inputMode="numeric" readOnly={fijada} aria-readonly={fijada}
            error={errors.ubicacion?.piso?.message}
            {...register('ubicacion.piso', { setValueAs: (v) => (v === '' || v == null ? null : Number(v)) })} />
          <Input etiqueta="Aula" readOnly={fijada} aria-readonly={fijada}
            error={errors.ubicacion?.aula?.message} {...register('ubicacion.aula')} />
        </div>
        {!fijada && manual && !sinCatalogo && (
          <Button variante="fantasma" tamano="sm" className="self-start" onClick={() => { setManual(false); fijar('edificio', ''); fijar('piso', null); fijar('aula', '') }}>
            Elegir de la lista
          </Button>
        )}
      </div>
    )
  }

  const edificios = unicos(ubicaciones.map((u) => u.edificio))
  const pisos = unicos(ubicaciones.filter((u) => u.edificio === edificio).map((u) => u.piso))
  const aulas = ubicaciones.filter((u) => u.edificio === edificio && u.piso === piso).map((u) => u.aula)
  const cargando = catalogo.isPending

  return (
    <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
      <Select etiqueta="Edificio" icono={<MapPin size={18} />} disabled={cargando}
        placeholder={cargando ? 'Cargando…' : 'Elige un edificio'} value={edificio}
        opciones={[...edificios.map((e) => ({ valor: e, texto: `Edificio ${e}` })), { valor: OTRO, texto: 'Otro lugar…' }]}
        error={errors.ubicacion?.edificio?.message}
        onChange={(e) => {
          if (e.target.value === OTRO) { setManual(true); fijar('edificio', ''); fijar('piso', null); fijar('aula', ''); return }
          const elegido = e.target.value
          const pisosDe = unicos(ubicaciones.filter((u) => u.edificio === elegido).map((u) => u.piso))
          fijar('edificio', elegido)
          fijar('piso', pisosDe.length === 1 ? pisosDe[0] : null)
          fijar('aula', '')
        }} />
      <Select etiqueta="Piso" disabled={!edificio} placeholder={edificio ? 'Elige' : 'Primero el edificio'}
        value={piso == null ? '' : String(piso)}
        opciones={pisos.map((p) => ({ valor: String(p), texto: textoPiso(p) }))}
        error={errors.ubicacion?.piso?.message}
        onChange={(e) => { fijar('piso', e.target.value === '' ? null : Number(e.target.value)); fijar('aula', '') }} />
      <Select etiqueta="Aula" disabled={piso == null || !edificio} placeholder={piso == null ? 'Primero el piso' : 'Elige un aula'}
        value={aula} opciones={aulas.map((a) => ({ valor: a, texto: a }))}
        error={errors.ubicacion?.aula?.message}
        onChange={(e) => fijar('aula', e.target.value)} />
    </div>
  )
}
