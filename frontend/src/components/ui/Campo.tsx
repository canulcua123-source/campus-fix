import { CircleAlert, ChevronDown } from 'lucide-react'
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

interface BaseCampo {
  /** Texto del <label> (obligatorio: el placeholder no es etiqueta, UX-22). */
  etiqueta: string
  /** Texto de ayuda bajo el campo. */
  ayuda?: ReactNode
  /** Mensaje de error en español claro; marca aria-invalid (UX-16). */
  error?: string
}

/** Calcula ids y atributos ARIA compartidos por Input, Select y Textarea. */
function useCampo(idPropio: string | undefined, { ayuda, error }: BaseCampo, describedBy?: string) {
  const generado = useId()
  const id = idPropio ?? generado
  const idAyuda = ayuda ? `${id}-ayuda` : undefined
  const idError = error ? `${id}-error` : undefined
  const descritoPor = [describedBy, idError, idAyuda].filter(Boolean).join(' ') || undefined
  return { id, idAyuda, idError, aria: { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': descritoPor } }
}

function Envoltura({ id, etiqueta, requerido, ayuda, error, idAyuda, idError, children }: BaseCampo & {
  id: string
  requerido?: boolean
  idAyuda?: string
  idError?: string
  children: ReactNode
}) {
  return (
    <div className="ui-campo">
      <label className="ui-campo__etiqueta" htmlFor={id}>
        {etiqueta}
        {requerido && <span className="ui-campo__requerido" aria-hidden>*</span>}
      </label>
      {children}
      {error && (
        <p id={idError} className="ui-campo__error">
          <CircleAlert size={14} aria-hidden /> {error}
        </p>
      )}
      {ayuda && <p id={idAyuda} className="ui-campo__ayuda">{ayuda}</p>}
    </div>
  )
}

export type InputProps = BaseCampo & InputHTMLAttributes<HTMLInputElement>

/** Campo de texto con etiqueta, ayuda y error. Compatible con `register()` de React Hook Form (pasa `ref`). */
export function Input({ etiqueta, ayuda, error, id: idPropio, required, 'aria-describedby': db, ...resto }: InputProps & { ref?: React.Ref<HTMLInputElement> }) {
  const c = useCampo(idPropio, { etiqueta, ayuda, error }, db)
  return (
    <Envoltura etiqueta={etiqueta} ayuda={ayuda} error={error} requerido={required} {...c}>
      <input required={required} {...c.aria} {...resto} />
    </Envoltura>
  )
}

export interface OpcionSelect {
  valor: string
  /** Texto legible en español (UX-20). */
  texto: string
}

export type SelectProps = BaseCampo & SelectHTMLAttributes<HTMLSelectElement> & {
  opciones: OpcionSelect[]
  /** Primera opción vacía, p. ej. "Elige una categoría". */
  placeholder?: string
}

export function Select({ etiqueta, ayuda, error, id: idPropio, required, opciones, placeholder, 'aria-describedby': db, ...resto }: SelectProps & { ref?: React.Ref<HTMLSelectElement> }) {
  const c = useCampo(idPropio, { etiqueta, ayuda, error }, db)
  return (
    <Envoltura etiqueta={etiqueta} ayuda={ayuda} error={error} requerido={required} {...c}>
      <div className="ui-campo__select">
        <select required={required} {...c.aria} {...resto}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {opciones.map((o) => (
            <option key={o.valor} value={o.valor}>{o.texto}</option>
          ))}
        </select>
        <ChevronDown size={18} aria-hidden />
      </div>
    </Envoltura>
  )
}

export type TextareaProps = BaseCampo & TextareaHTMLAttributes<HTMLTextAreaElement>

export function Textarea({ etiqueta, ayuda, error, id: idPropio, required, 'aria-describedby': db, ...resto }: TextareaProps & { ref?: React.Ref<HTMLTextAreaElement> }) {
  const c = useCampo(idPropio, { etiqueta, ayuda, error }, db)
  return (
    <Envoltura etiqueta={etiqueta} ayuda={ayuda} error={error} requerido={required} {...c}>
      <textarea required={required} {...c.aria} {...resto} />
    </Envoltura>
  )
}
