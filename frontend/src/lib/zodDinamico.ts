import { z } from 'zod'
import type { CampoCategoria } from '../schemas/catalogos'

/**
 * T-061: genera en tiempo de ejecución el esquema Zod del `detalle_especifico` de una categoría a partir de su
 * definición de `GET /categorias`. Espejo de `construir_modelo_detalle` (backend/app/dominio/detalle.py):
 * objeto estricto con `categoria` literal; texto → min/max de longitud; numero → número finito; entero → int;
 * booleano; ip → IPv4/IPv6; lista → una de las opciones. Opcional = puede omitirse (nunca null).
 */

export type ValoresDetalle = Record<string, unknown>

function esquemaCampo(campo: CampoCategoria): z.ZodType {
  const { min, max } = campo
  switch (campo.tipo) {
    case 'texto': {
      let s = z.string('Escribe un texto')
      if (min !== undefined) s = s.min(min, min === 1 ? 'Este campo es obligatorio' : `Mínimo ${min} caracteres`)
      if (max !== undefined) s = s.max(max, `Máximo ${max} caracteres`)
      if (campo.max_length !== undefined) s = s.max(campo.max_length, `Máximo ${campo.max_length} caracteres`)
      if (campo.patron) s = s.regex(new RegExp(campo.patron), 'Formato no válido')
      return s
    }
    case 'numero':
    case 'entero': {
      let n = z.number('Escribe un número').finite('Escribe un número')
      if (campo.tipo === 'entero') n = n.int('Debe ser un número entero')
      if (min !== undefined) n = n.min(min, `Mínimo ${min}`)
      if (max !== undefined) n = n.max(max, `Máximo ${max}`)
      return n
    }
    case 'booleano':
      return z.boolean('Elige sí o no')
    case 'ip':
      return z.union([z.ipv4(), z.ipv6()], 'IP inválida')
    case 'lista':
    case 'enum': {
      const opciones = campo.opciones ?? []
      return opciones.length ? z.enum(opciones as [string, ...string[]], 'Elige una opción de la lista') : z.never()
    }
    case 'lista_texto':
      return z.array(z.string())
  }
}

/** Esquema del detalle de `categoria` (para `zodResolver` o `safeParse`). */
export function esquemaDetalle(categoria: { clave: string; campos: readonly CampoCategoria[] }) {
  const forma: Record<string, z.ZodType> = { categoria: z.literal(categoria.clave) }
  for (const campo of categoria.campos) forma[campo.nombre] = campo.requerido ? esquemaCampo(campo) : esquemaCampo(campo).optional()
  return z.strictObject(forma)
}

/** Quita valores vacíos de los campos opcionales para no mandar '' ni null (la BD rechaza null). */
export function limpiarDetalle(categoria: { clave: string; campos: readonly CampoCategoria[] }, valores: ValoresDetalle): ValoresDetalle {
  const salida: ValoresDetalle = { categoria: categoria.clave }
  for (const campo of categoria.campos) {
    const v = valores[campo.nombre]
    const vacio = v === undefined || v === null || v === '' || (typeof v === 'number' && Number.isNaN(v))
    if (!vacio) salida[campo.nombre] = v
  }
  return salida
}

/** Valida y devuelve `{ datos }` listos para la API o `{ errores }` por nombre de campo. */
export function validarDetalle(categoria: { clave: string; campos: readonly CampoCategoria[] }, valores: ValoresDetalle):
  { datos: ValoresDetalle; errores?: undefined } | { datos?: undefined; errores: Record<string, string> } {
  const r = esquemaDetalle(categoria).safeParse(limpiarDetalle(categoria, valores))
  if (r.success) return { datos: r.data as ValoresDetalle }
  const errores: Record<string, string> = {}
  for (const issue of r.error.issues) {
    const clave = String(issue.path[0] ?? '_general')
    const requerido = categoria.campos.find((c) => c.nombre === clave)?.requerido
    errores[clave] ??= issue.code === 'invalid_type' && requerido && issue.input === undefined ? 'Este campo es obligatorio' : issue.message
  }
  return { errores }
}
