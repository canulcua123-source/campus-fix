import { useState, type FormEvent } from 'react'
import { mensajeDeError } from '../api/client'
import { useMe } from '../api/hooks/auth'
import { useComentarioReportante } from '../api/hooks/incidencias'
import { useAuth } from '../auth/store'
import { Button, Card, Textarea } from './ui'

interface Props {
  incidenciaId: string
  reportanteId: string
}

/** Solo para el reportante propietario mientras la incidencia está en espera: agrega información a la bitácora. */
export function AgregarInformacion({ incidenciaId, reportanteId }: Props) {
  const puedeVer = useAuth((s) => s.tiene('incidencias:ver'))
  const me = useMe()
  const comentario = useComentarioReportante(incidenciaId)
  const [texto, setTexto] = useState('')
  const [error, setError] = useState<string>()
  const [enviado, setEnviado] = useState(false)

  if (!puedeVer || !me.data || me.data._id !== reportanteId) return null

  const enviar = (e: FormEvent) => {
    e.preventDefault()
    const limpio = texto.trim()
    if (limpio.length < 5) return setError('Escribe al menos 5 caracteres.')
    if (limpio.length > 1000) return setError('Máximo 1000 caracteres.')
    setError(undefined)
    setEnviado(false)
    comentario.mutate({ comentario: limpio }, {
      onSuccess: () => {
        setTexto('')
        setEnviado(true)
      },
    })
  }

  return (
    <Card como="section" className="mb-3">
      <h2 className="mb-1 mt-0 text-base font-semibold text-ink">Agregar información</h2>
      <p className="mb-3 mt-0 text-sm text-muted">Tu reporte está en espera. Agrega datos que ayuden al técnico a continuar.</p>
      <form noValidate onSubmit={enviar} className="flex flex-col gap-3">
        <Textarea
          etiqueta="Información adicional"
          required
          error={error}
          value={texto}
          maxLength={1000}
          rows={3}
          onChange={(e) => setTexto(e.target.value)}
        />
        {enviado && (
          <p role="status" className="m-0 rounded-input border border-ok p-3 text-sm text-ok">Agregamos tu información a la bitácora.</p>
        )}
        {comentario.isError && (
          <p role="alert" className="m-0 rounded-input border border-bad p-3 text-sm text-bad">
            {mensajeDeError(comentario.error, 'No pudimos enviar tu información. Intenta de nuevo.')}
          </p>
        )}
        <div>
          <Button type="submit" cargando={comentario.isPending} textoCargando="Enviando…">Enviar información</Button>
        </div>
      </form>
    </Card>
  )
}
