import { useId } from 'react'
import type { CampoCategoria } from '../schemas/catalogos'
import type { ValoresDetalle } from '../lib/zodDinamico'
import { Input, Select } from './ui'

interface CamposCategoriaProps {
  campos: readonly CampoCategoria[]
  valores: ValoresDetalle
  onCambio: (nombre: string, valor: unknown) => void
  errores?: Record<string, string>
  disabled?: boolean
}

const etiquetaDe = (c: CampoCategoria) => c.etiqueta || c.nombre.replaceAll('_', ' ')

function ayudaDe(c: CampoCategoria): string | undefined {
  if (c.tipo === 'texto' && (c.min !== undefined || c.max !== undefined)) {
    if (c.min !== undefined && c.max !== undefined) return `De ${c.min} a ${c.max} caracteres`
    return c.min !== undefined ? `Mínimo ${c.min} caracteres` : `Máximo ${c.max} caracteres`
  }
  if ((c.tipo === 'numero' || c.tipo === 'entero') && (c.min !== undefined || c.max !== undefined)) {
    if (c.min !== undefined && c.max !== undefined) return `Entre ${c.min} y ${c.max}`
    return c.min !== undefined ? `Mínimo ${c.min}` : `Máximo ${c.max}`
  }
  if (c.tipo === 'ip') return 'Ej. 10.0.0.15'
  return undefined
}

/**
 * T-061: dibuja los campos de `detalle_especifico` desde la definición de `GET /categorias` (o del constructor de
 * Admin de categorías). Controlado: el padre guarda los valores y valida con `validarDetalle` (lib/zodDinamico).
 */
export function CamposCategoria({ campos, valores, onCambio, errores = {}, disabled }: CamposCategoriaProps) {
  const base = useId()
  return (
    <div className="flex flex-col gap-3">
      {campos.map((c) => {
        const id = `${base}-${c.nombre}`
        const comun = { id, etiqueta: etiquetaDe(c), required: c.requerido, error: errores[c.nombre], disabled, ayuda: ayudaDe(c) }
        const valor = valores[c.nombre]
        switch (c.tipo) {
          case 'booleano':
            return (
              <div key={c.nombre}>
                <label htmlFor={id} className="flex min-h-11 items-center gap-2 text-ink">
                  <input
                    id={id}
                    type="checkbox"
                    style={{ width: 20, minHeight: 20 }}
                    checked={valor === true}
                    disabled={disabled}
                    aria-invalid={errores[c.nombre] ? true : undefined}
                    onChange={(e) => onCambio(c.nombre, e.target.checked)}
                  />
                  {etiquetaDe(c)}
                </label>
                {errores[c.nombre] && <p className="campo-error">{errores[c.nombre]}</p>}
              </div>
            )
          case 'lista':
          case 'enum':
            return (
              <Select
                key={c.nombre}
                {...comun}
                placeholder="Elige una opción"
                value={typeof valor === 'string' ? valor : ''}
                opciones={(c.opciones ?? []).map((o) => ({ valor: o, texto: o }))}
                onChange={(e) => onCambio(c.nombre, e.target.value)}
              />
            )
          case 'numero':
          case 'entero':
            return (
              <Input
                key={c.nombre}
                {...comun}
                type="number"
                inputMode={c.tipo === 'entero' ? 'numeric' : 'decimal'}
                step={c.tipo === 'entero' ? 1 : 'any'}
                value={typeof valor === 'number' && !Number.isNaN(valor) ? valor : ''}
                onChange={(e) => onCambio(c.nombre, e.target.value === '' ? undefined : e.target.valueAsNumber)}
              />
            )
          case 'lista_texto':
            return (
              <Input
                key={c.nombre}
                {...comun}
                ayuda="Separa los valores con comas"
                value={Array.isArray(valor) ? valor.join(', ') : ''}
                onChange={(e) => onCambio(c.nombre, e.target.value.split(',').map((v) => v.trim()).filter(Boolean))}
              />
            )
          default:
            return (
              <Input
                key={c.nombre}
                {...comun}
                type="text"
                inputMode={c.tipo === 'ip' ? 'decimal' : undefined}
                value={typeof valor === 'string' ? valor : ''}
                onChange={(e) => onCambio(c.nombre, e.target.value)}
              />
            )
        }
      })}
    </div>
  )
}
