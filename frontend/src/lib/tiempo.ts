/** Texto relativo corto en español: "Hace 5 min", "Hace 3 h", "Hace 2 d". */
export function haceCuanto(fecha: string, ahora = Date.now()): string {
  const valor = new Date(fecha).getTime()
  if (Number.isNaN(valor)) return ''
  const horas = Math.max(0, (ahora - valor) / 3_600_000)
  if (horas < 1) return `Hace ${Math.max(1, Math.round(horas * 60))} min`
  if (horas < 24) return `Hace ${Math.floor(horas)} h`
  return `Hace ${Math.floor(horas / 24)} d`
}
