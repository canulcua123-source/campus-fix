import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { ApiError } from '../api/client'
import { analiticaTagsQuery } from '../api/analitica'
import { useTags } from '../api/hooks/incidencias'
import { useAuth } from '../auth/store'
import { filtrarSugerencias, normalizarTag, validarTag } from '../lib/tags'
import { Button } from './ui/Button'
import { Input } from './ui/Campo'

interface EditorTagsProps {
    incidenciaId: string
    tags: readonly string[]
}

function mensajeDeError(error: unknown): string {
    if (error instanceof ApiError) {
        if (error.status === 404) return 'Esta incidencia ya no está disponible o no está dentro de tu alcance.'
        if (error.status === 403) return 'No tienes permiso para modificar las etiquetas.'
        if (error.status === 409) return 'La incidencia cambió. Actualiza el detalle e intenta nuevamente.'
        return error.mensaje
    }
    return 'No pudimos guardar la etiqueta. Intenta nuevamente.'
}

/** T-053: edición accesible; la API y el backend son la autoridad de permisos y etiquetas. */
export function EditorTags({ incidenciaId, tags }: EditorTagsProps) {
    const usuario = useAuth((estado) => estado.usuario)
    const puedeEditar = usuario?.permisos.includes('tags:gestionar') ?? false
    // TEC puede editar tags, pero no dispone de analitica:ver: no hacer GET que devolvería 403.
    const puedeSugerir = puedeEditar && (usuario?.permisos.includes('analitica:ver') ?? false)
    const sugerenciasQuery = useQuery({ ...analiticaTagsQuery(), enabled: puedeSugerir })
    const { agregar, quitar } = useTags(incidenciaId)
    const [texto, setTexto] = useState('')
    const [tocado, setTocado] = useState(false)
    const [error, setError] = useState('')
    const [aviso, setAviso] = useState('')
    const [ocupado, setOcupado] = useState(false)
    const escribiendo = useRef(false)

    const preview = normalizarTag(texto)
    const evaluacion = validarTag(texto)
    const validacionVisible = tocado && texto.trim().length > 0 && !evaluacion.valido
    const sugerencias = filtrarSugerencias(sugerenciasQuery.data ?? [], tags, texto)
    const completo = tags.length >= 15

    async function agregarEtiqueta(valor: string) {
        if (!puedeEditar || escribiendo.current) return
        const resultado = validarTag(valor)
        setTocado(true)
        setAviso('')
        if (resultado.valido === false) {
            setError(resultado.mensaje)
            return
        }
        if (tags.includes(resultado.tag)) {
            setError('La etiqueta ya está registrada en esta incidencia.')
            return
        }
        if (completo) {
            setError('Esta incidencia ya tiene el máximo de 15 etiquetas.')
            return
        }
        escribiendo.current = true
        setOcupado(true)
        setError('')
        try {
            await agregar.mutateAsync({ tags: [resultado.tag] })
            setTexto('')
            setTocado(false)
            setAviso(`Etiqueta ${resultado.tag} agregada.`)
        } catch (fallo) {
            setError(mensajeDeError(fallo))
        } finally {
            escribiendo.current = false
            setOcupado(false)
        }
    }

    async function quitarEtiqueta(tag: string) {
        if (!puedeEditar || escribiendo.current || !tags.includes(tag)) return
        escribiendo.current = true
        setOcupado(true)
        setAviso('')
        setError('')
        try {
            await quitar.mutateAsync({ tags: [tag] })
            setAviso(`Etiqueta ${tag} eliminada.`)
        } catch (fallo) {
            setError(mensajeDeError(fallo))
        } finally {
            escribiendo.current = false
            setOcupado(false)
        }
    }

    function enviar(evento: FormEvent<HTMLFormElement>) {
        evento.preventDefault()
        void agregarEtiqueta(texto)
    }

    function manejarTeclado(evento: KeyboardEvent<HTMLInputElement>) {
        if (evento.key === 'Backspace' && texto.length === 0 && tags.length > 0 && !ocupado) {
            evento.preventDefault()
            void quitarEtiqueta(tags[tags.length - 1])
        }
    }

    return (
        <div className="flex flex-col gap-3" aria-label="Editor de etiquetas técnicas">
            <div className="flex flex-wrap items-center gap-2" aria-label="Etiquetas actuales">
                {tags.length === 0 && <p className="my-0 text-sm text-muted">Esta incidencia todavía no tiene etiquetas.</p>}
                {tags.map((tag) => (
                    <span key={tag} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line bg-panel-2 pl-3 pr-1 text-sm text-ink">
                        <span>#{tag}</span>
                        {puedeEditar && (
                            <Button
                                type="button"
                                variante="fantasma"
                                className="min-h-11 min-w-11"
                                disabled={ocupado}
                                onClick={() => void quitarEtiqueta(tag)}
                                aria-label={`Quitar etiqueta ${tag}`}
                            >
                                <X size={18} aria-hidden="true" />
                            </Button>
                        )}
                    </span>
                ))}
            </div>

            {puedeEditar && (
                <>
                    <form onSubmit={enviar} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                        <div className="min-w-0 flex-1">
                            <Input
                                etiqueta="Nueva etiqueta"
                                name="tag"
                                type="text"
                                autoComplete="off"
                                value={texto}
                                placeholder="Ej. Cableado Dañado"
                                disabled={ocupado || completo}
                                error={error || (validacionVisible && evaluacion.valido === false ? evaluacion.mensaje : undefined)}
                                ayuda={`${texto.length > 0 ? `Vista previa: ${preview || '—'}. ` : ''}De 2 a 30 caracteres; Enter agrega y Retroceso con el campo vacío quita la última.`}
                                onChange={(evento) => { setTexto(evento.target.value); setError(''); setAviso('') }}
                                onBlur={() => setTocado(true)}
                                onKeyDown={manejarTeclado}
                            />
                        </div>
                        <Button type="submit" disabled={ocupado || completo || texto.trim().length === 0} cargando={ocupado} icono={<Plus size={18} />}>
                            Agregar etiqueta
                        </Button>
                    </form>

                    {completo && <p className="m-0 text-sm text-muted">Máximo de 15 etiquetas. Elimina una para añadir otra.</p>}
                    {aviso && <p role="status" aria-live="polite" className="m-0 text-sm text-ok">{aviso}</p>}

                    {puedeSugerir && !completo && (
                        <div className="flex flex-col gap-2">
                            <p className="m-0 text-sm font-semibold text-ink">Sugerencias frecuentes</p>
                            {sugerenciasQuery.isPending && <p role="status" className="m-0 text-sm text-muted">Cargando sugerencias…</p>}
                            {sugerenciasQuery.isError && (
                                <div role="status" className="text-sm text-muted">
                                    No se pudieron consultar sugerencias. Puedes agregar etiquetas manualmente.
                                    <Button variante="fantasma" onClick={() => void sugerenciasQuery.refetch()}>Reintentar sugerencias</Button>
                                </div>
                            )}
                            {sugerenciasQuery.isSuccess && sugerencias.length === 0 && <p className="m-0 text-sm text-muted">No hay sugerencias disponibles.</p>}
                            {sugerenciasQuery.isSuccess && sugerencias.length > 0 && (
                                <div className="flex flex-wrap gap-2" aria-label="Sugerencias de etiquetas">
                                    {sugerencias.map((tag) => (
                                        <Button
                                            key={tag}
                                            variante="secundario"
                                            disabled={ocupado}
                                            onClick={() => void agregarEtiqueta(tag)}
                                            aria-label={`Agregar sugerencia ${tag}`}
                                        >
                                            <Plus size={16} aria-hidden="true" /> {tag}
                                        </Button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                    {!puedeSugerir && <p className="m-0 text-xs text-muted">Puedes escribir etiquetas manualmente. Las sugerencias requieren acceso a analítica.</p>}
                </>
            )}
        </div>
    )
}