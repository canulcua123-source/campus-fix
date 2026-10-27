import type { OpcionSelect } from '../components/ui'
import {
  ETIQUETAS_CATEGORIA, ETIQUETAS_PLATAFORMA, ETIQUETAS_PRIORIDAD, ETIQUETAS_RIESGO, ETIQUETAS_TIPO_DANO,
} from '../schemas/etiquetas'

/**
 * Etiquetas humanas de los enums para formularios (UX-20): el `value` es el valor de la API y el texto es español
 * («critica» → «Crítica», «filtracion» → «Filtración»). Los textos viven en `schemas/etiquetas.ts`.
 */
export {
  ETIQUETAS_CATEGORIA, ETIQUETAS_PLATAFORMA, ETIQUETAS_PRIORIDAD, ETIQUETAS_RIESGO, ETIQUETAS_TIPO_DANO,
} from '../schemas/etiquetas'

/** `{ critica: 'Crítica' }` → `[{ valor: 'critica', texto: 'Crítica' }]`, en el orden del mapa. */
export function opcionesDe(mapa: Readonly<Record<string, string>>): OpcionSelect[] {
  return Object.entries(mapa).map(([valor, texto]) => ({ valor, texto }))
}

export const OPCIONES_PRIORIDAD = opcionesDe(ETIQUETAS_PRIORIDAD)
export const OPCIONES_CATEGORIA = opcionesDe(ETIQUETAS_CATEGORIA)
export const OPCIONES_TIPO_DANO = opcionesDe(ETIQUETAS_TIPO_DANO)
export const OPCIONES_RIESGO = opcionesDe(ETIQUETAS_RIESGO)
export const OPCIONES_PLATAFORMA = opcionesDe(ETIQUETAS_PLATAFORMA)
