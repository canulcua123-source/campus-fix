import { useState } from 'react'
import { mensajeDeError } from '../api/client'
import { useMe } from '../api/hooks/auth'
import { useConfirmacion } from '../api/hooks/incidencias'
import { useAuth } from '../auth/store'
import { dentroDePlazoReapertura } from '../lib/detalle'
import { BottomSheet, Button, Card, Textarea } from './ui'

interface Props {
  incidenciaId: string
  reportanteId: string
  fechaResolucion?: string
  /** Aviso de éxito para la página (la tarjeta desaparece al cambiar el estado). */
  onHecho: (mensaje: string) => void
}

/** Solo para el reportante propietario de una incidencia resuelta: confirma (cierra) o reabre. */
export function ConfirmarSolucion({ incidenciaId, reportanteId, fechaResolucion, onHecho }: Props) {
  const puedeVer = useAuth((s) => s.tiene('incidencias:ver'))
  const me = useMe()
  const confirmacion = useConfirmacion(incidenciaId)
  const [reabriendo, setReabriendo] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [errorMotivo, setErrorMotivo] = useState<string>()

  if (!puedeVer || !me.data || me.data._id !== reportanteId) return null
  const puedeReabrir = dentroDePlazoReapertura(fechaResolucion)
  const enviando = confirmacion.isPending

  const confirmar = () => confirmacion.mutate({ accion: 'confirmar' }, {
    onSuccess: () => onHecho('Gracias por confirmar. La incidencia quedó cerrada.'),
  })

  const reabrir = () => {
    const texto = motivo.trim()
    if (texto && texto.length < 5) return setErrorMotivo('Escribe al menos 5 caracteres o deja el motivo vacío.')
    if (texto.length > 1000) return setErrorMotivo('Máximo 1000 caracteres.')
    setErrorMotivo(undefined)
    confirmacion.mutate({ accion: 'reabrir', ...(texto ? { comentario: texto } : {}) }, {
      onSuccess: () => {
        setReabriendo(false)
        onHecho('Reabrimos tu reporte. Un técnico volverá a revisarlo.')
      },
      onError: () => setReabriendo(false),
    })
  }

  return (
    <Card como="section" className="mb-3">
      <h2 className="mb-1 mt-0 text-base font-semibold text-ink">¿Se resolvió tu problema?</h2>
      <p className="mb-3 mt-0 text-sm text-muted">
        {puedeReabrir
          ? 'Confirma para cerrar el reporte o reábrelo si el problema sigue (tienes 7 días desde la resolución).'
          : 'Confirma para cerrar el reporte. El plazo de 7 días para reabrirlo ya terminó.'}
      </p>
      {confirmacion.isError && (
        <p role="alert" className="mb-3 mt-0 rounded-input border border-bad p-3 text-sm text-bad">
          {mensajeDeError(confirmacion.error, 'No pudimos guardar tu respuesta. Intenta de nuevo.')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button cargando={enviando && !reabriendo} textoCargando="Confirmando…" disabled={enviando} onClick={confirmar}>
          Sí, confirmar
        </Button>
        {puedeReabrir && (
          <Button
            variante="secundario"
            disabled={enviando}
            onClick={() => {
              confirmacion.reset()
              setReabriendo(true)
            }}
          >
            No, reabrir
          </Button>
        )}
      </div>

      <BottomSheet
        abierto={reabriendo}
        onCerrar={() => { if (!enviando) setReabriendo(false) }}
        titulo="Reabrir reporte"
        acciones={(
          <>
            <Button variante="secundario" disabled={enviando} onClick={() => setReabriendo(false)}>Cancelar</Button>
            <Button cargando={enviando} textoCargando="Reabriendo…" onClick={reabrir}>Reabrir reporte</Button>
          </>
        )}
      >
        <Textarea
          etiqueta="Motivo (opcional)"
          ayuda="Cuéntale al técnico qué sigue fallando."
          error={errorMotivo}
          value={motivo}
          maxLength={1000}
          rows={4}
          onChange={(e) => setMotivo(e.target.value)}
        />
      </BottomSheet>
    </Card>
  )
}
