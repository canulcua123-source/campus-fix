import type { IncidenciaListaItem } from '../schemas/incidencia'
import { ETIQUETAS_CATEGORIA, ETIQUETAS_ESTADO, ETIQUETAS_PRIORIDAD } from '../schemas/etiquetas'
import { formatearFecha } from './detalle'

export type CeldaCsv = string | number | null | undefined

/** BOM UTF-8: Excel lo necesita para mostrar acentos correctamente. */
export const BOM = '﻿'

/**
 * Escapa una celda según RFC 4180 y neutraliza fórmulas (=, +, -, @, tab, CR al inicio)
 * para evitar inyección de fórmulas al abrir el archivo en Excel.
 */
export function escaparCelda(valor: CeldaCsv): string {
  if (valor === null || valor === undefined) return ''
  let texto = String(valor)
  if (typeof valor === 'string' && /^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`
  return /[",\r\n]/.test(texto) || texto !== texto.trim() ? `"${texto.replace(/"/g, '""')}"` : texto
}

/** Construye el texto CSV (con BOM, separador coma y fin de línea CRLF). */
export function construirCsv(encabezados: readonly string[], filas: readonly (readonly CeldaCsv[])[]): string {
  const lineas = [encabezados, ...filas].map((fila) => fila.map(escaparCelda).join(','))
  return BOM + lineas.join('\r\n') + '\r\n'
}

export const ENCABEZADOS_INCIDENCIAS = [
  'Folio', 'Título', 'Categoría', 'Prioridad', 'Estado', 'Edificio', 'Piso', 'Aula', 'Técnico asignado', 'Fecha de creación',
] as const

/** CSV de incidencias con etiquetas legibles y fechas es-MX (America/Mexico_City). */
export function incidenciasACsv(incidencias: readonly IncidenciaListaItem[]): string {
  return construirCsv(ENCABEZADOS_INCIDENCIAS, incidencias.map((i) => [
    i.codigo,
    i.titulo,
    ETIQUETAS_CATEGORIA[i.categoria],
    ETIQUETAS_PRIORIDAD[i.prioridad],
    ETIQUETAS_ESTADO[i.estado],
    i.ubicacion.edificio,
    i.ubicacion.piso ?? '',
    i.ubicacion.aula,
    i.tecnico_asignado?.nombre ?? 'Sin asignar',
    formatearFecha(i.fecha_creacion),
  ]))
}

/** Intervalo [desde 00:00 UTC, hasta + 1 día 00:00 UTC), igual que FiltrosAnalitica en el backend. */
export function intervaloUtc(desde?: string, hasta?: string): { inicio: number; fin: number } {
  const inicio = desde ? Date.parse(`${desde}T00:00:00Z`) : -Infinity
  const fin = hasta ? Date.parse(`${hasta}T00:00:00Z`) + 86_400_000 : Infinity
  return { inicio, fin }
}

export function enPeriodo(fechaIso: string, intervalo: { inicio: number; fin: number }): boolean {
  const t = Date.parse(fechaIso)
  return !Number.isNaN(t) && t >= intervalo.inicio && t < intervalo.fin
}
