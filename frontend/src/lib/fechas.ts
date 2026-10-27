/** Fechas de calendario (YYYY-MM-DD) en la zona America/Mexico_City (UX-28), sin depender de la zona del dispositivo. */

const formatoDia = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Día actual en México como "YYYY-MM-DD". */
export function hoyEnMexico(ahora: Date = new Date()): string {
  return formatoDia.format(ahora)
}

/** Resta `dias` a una fecha "YYYY-MM-DD" (aritmética de calendario pura, sin horas). */
export function restarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d - dias)).toISOString().slice(0, 10)
}

/** Últimos `n` días contando hoy: { desde: hoy − (n − 1), hasta: hoy }. */
export function rangoUltimosDias(n: number, ahora: Date = new Date()): { desde: string; hasta: string } {
  const hasta = hoyEnMexico(ahora)
  return { desde: restarDias(hasta, n - 1), hasta }
}
