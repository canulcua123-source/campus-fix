import { Paperclip, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useEvidencia } from '../api/hooks/incidencias'
import { nombreSeguro } from '../lib/archivos'
import { ErrorImagen } from '../lib/imagen'
import { procesarFotoEnSegundoPlano } from '../lib/fotoEnSegundoPlano'
import { evidenciaFirmaSchema, TIPOS_MIME_EVIDENCIA, type TipoMimeEvidencia } from '../schemas/incidencia'
import { Button } from './ui'

/** Máximo de evidencias por incidencia (MAX_EVIDENCIAS del backend). */
export const MAX_EVIDENCIAS = 10
const ACCEPT_EVIDENCIA = TIPOS_MIME_EVIDENCIA.join(',')

interface SubirEvidenciaProps {
  incidenciaId: string
  /** Evidencias ya adjuntas (para el límite de 10). */
  cantidad: number
}

type Estado =
  | { tipo: 'inactivo' }
  | { tipo: 'preparando' }
  | { tipo: 'subiendo'; progreso: number }
  | { tipo: 'ok'; nombre: string }
  | { tipo: 'error'; mensaje: string }

const esCancelacion = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'

/**
 * Adjunta evidencias desde el detalle (T-048): fotos procesadas (JPEG sin EXIF, 2048 px) o PDF ≤ 10 MB, hasta 10.
 * Valida tipo, peso y límite antes de pedir la firma; muestra el progreso real del PUT y permite cancelar.
 */
export function SubirEvidencia({ incidenciaId, cantidad }: SubirEvidenciaProps) {
  const entrada = useRef<HTMLInputElement>(null)
  const cancelar = useRef<AbortController | null>(null)
  const [estado, setEstado] = useState<Estado>({ tipo: 'inactivo' })
  const { mutateAsync } = useEvidencia(incidenciaId)
  const lleno = cantidad >= MAX_EVIDENCIAS
  const ocupado = estado.tipo === 'preparando' || estado.tipo === 'subiendo'

  useEffect(() => () => cancelar.current?.abort(), []) // al salir del detalle se cancela la subida en curso

  async function adjuntar(archivo: File) {
    if (lleno) {
      setEstado({ tipo: 'error', mensaje: `Se alcanzó el límite de ${MAX_EVIDENCIAS} evidencias.` })
      return
    }
    if (!(TIPOS_MIME_EVIDENCIA as readonly string[]).includes(archivo.type)) {
      setEstado({ tipo: 'error', mensaje: 'Formato no permitido. Adjunta una foto JPEG, PNG o WebP, o un PDF.' })
      return
    }
    const control = new AbortController()
    cancelar.current = control
    setEstado({ tipo: 'preparando' })
    try {
      let blob: Blob = archivo
      let nombre = nombreSeguro(archivo.name)
      if (archivo.type !== 'application/pdf') {
        // Fotos: orientación aplicada y sin EXIF/GPS, igual que en Reportar.
        blob = (await procesarFotoEnSegundoPlano(archivo)).evidencia
        nombre = nombreSeguro(archivo.name, 'jpg')
      }
      if (control.signal.aborted) return
      const valida = evidenciaFirmaSchema.safeParse({
        nombre_archivo: nombre, tipo_mime: blob.type as TipoMimeEvidencia, peso_bytes: blob.size,
      })
      if (!valida.success) {
        setEstado({ tipo: 'error', mensaje: valida.error.issues[0]?.message ?? 'Archivo no válido' })
        return
      }
      setEstado({ tipo: 'subiendo', progreso: 0 })
      await mutateAsync({
        archivo: blob,
        nombre,
        signal: control.signal,
        renovarFirmaExpirada: true,
        onProgreso: (f) => setEstado({ tipo: 'subiendo', progreso: f }),
      })
      setEstado({ tipo: 'ok', nombre })
    } catch (e) {
      if (esCancelacion(e) || control.signal.aborted) {
        setEstado({ tipo: 'error', mensaje: 'Subida cancelada.' })
        return
      }
      const mensaje = e instanceof ErrorImagen || e instanceof Error ? e.message : 'No se pudo adjuntar la evidencia.'
      setEstado({ tipo: 'error', mensaje })
    } finally {
      if (cancelar.current === control) cancelar.current = null
    }
  }

  const porcentaje = estado.tipo === 'subiendo' ? Math.round(estado.progreso * 100) : 0

  return (
    <div className="mt-3 flex flex-col gap-2">
      <input
        ref={entrada}
        type="file"
        accept={ACCEPT_EVIDENCIA}
        hidden
        aria-label="Archivo de evidencia"
        onChange={(e) => {
          const archivo = e.target.files?.[0]
          e.target.value = ''
          if (archivo) void adjuntar(archivo)
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variante="secundario"
          icono={<Paperclip size={18} aria-hidden />}
          disabled={lleno || ocupado}
          onClick={() => entrada.current?.click()}
        >
          Adjuntar evidencia
        </Button>
        <span className="text-sm text-muted">
          {lleno
            ? `Límite de ${MAX_EVIDENCIAS} evidencias alcanzado`
            : `JPG, PNG, WebP o PDF hasta 10 MB · ${cantidad} de ${MAX_EVIDENCIAS}`}
        </span>
      </div>

      {estado.tipo === 'preparando' && <p role="status" className="m-0 text-sm text-muted">Preparando el archivo…</p>}
      {estado.tipo === 'subiendo' && (
        <div className="flex items-center gap-2">
          <div
            role="progressbar"
            aria-label="Progreso de la subida"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={porcentaje}
            className="h-2 flex-1 overflow-hidden rounded-full bg-panel-2"
          >
            <div className="h-full bg-brand" style={{ width: `${porcentaje}%` }} />
          </div>
          <span className="w-12 text-right text-sm tabular-nums text-muted">{porcentaje} %</span>
          <Button variante="fantasma" icono={<X size={18} aria-hidden />} onClick={() => cancelar.current?.abort()}>
            Cancelar
          </Button>
        </div>
      )}
      {estado.tipo === 'ok' && <p role="status" className="m-0 text-sm text-ok">Se adjuntó {estado.nombre}.</p>}
      {estado.tipo === 'error' && <p role="alert" className="m-0 text-sm text-bad">{estado.mensaje}</p>}
    </div>
  )
}
