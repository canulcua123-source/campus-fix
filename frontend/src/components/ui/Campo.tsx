import clsx from 'clsx'
import { CircleAlert, ChevronDown } from 'lucide-react'
import {
  useCallback, useEffect, useId, useRef, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'

export type TamanoCampo = 'md' | 'sm'

interface BaseCampo {
  /** Texto del <label> (obligatorio: el placeholder no es etiqueta, UX-22). */
  etiqueta: string
  /** Texto de ayuda bajo el campo. */
  ayuda?: ReactNode
  /** Mensaje de error en español claro; marca aria-invalid (UX-16). */
  error?: string
  /** md = 44 px (formularios); sm = 40 px en escritorio y 44 px en táctil (barras de filtros). */
  tamano?: TamanoCampo
  /** Oculta la etiqueta visualmente (sigue para lectores de pantalla). Úsalo solo si el contexto es obvio (buscador). */
  etiquetaOculta?: boolean
  /** Clase del contenedor del campo (p. ej. para ubicarlo en una rejilla). `className` va al control. */
  claseCampo?: string
}

/** Calcula ids y atributos ARIA compartidos por Input, Select y Textarea. */
function useCampo(idPropio: string | undefined, { ayuda, error }: Pick<BaseCampo, 'ayuda' | 'error'>, describedBy?: string) {
  const generado = useId()
  const id = idPropio ?? generado
  const idAyuda = ayuda ? `${id}-ayuda` : undefined
  const idError = error ? `${id}-error` : undefined
  const descritoPor = [describedBy, idError, idAyuda].filter(Boolean).join(' ') || undefined
  return { id, idAyuda, idError, aria: { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': descritoPor } }
}

function Envoltura({ id, etiqueta, requerido, ayuda, error, idAyuda, idError, tamano = 'md', etiquetaOculta, claseCampo, children }: BaseCampo & {
  id: string
  requerido?: boolean
  idAyuda?: string
  idError?: string
  children: ReactNode
}) {
  return (
    <div className={clsx('ui-campo', tamano === 'sm' && 'ui-campo--sm', claseCampo)}>
      <label className={clsx('ui-campo__etiqueta', etiquetaOculta && 'sr-only')} htmlFor={id}>
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

/** Asigna un elemento a un ref de React (objeto o función). */
function asignarRef<T>(ref: Ref<T> | undefined, valor: T | null) {
  if (typeof ref === 'function') ref(valor)
  else if (ref) (ref as { current: T | null }).current = valor
}

const TIPOS_FECHA: Record<string, string> = {
  date: 'dd/mm/aaaa',
  'datetime-local': 'dd/mm/aaaa --:--',
  time: '--:--',
  month: 'mm/aaaa',
}

export type InputProps = BaseCampo & InputHTMLAttributes<HTMLInputElement> & {
  /** Ícono lucide-react al inicio del campo (decorativo). */
  icono?: ReactNode
  /** Botón al final del campo (p. ej. mostrar contraseña). Debe medir 44 px y tener `aria-label`. */
  accion?: ReactNode
}

/**
 * Campo de texto con etiqueta, ayuda y error. Compatible con `register()` de React Hook Form (pasa `ref`).
 * En fechas vacías marca `data-vacio="true"` y muestra el placeholder ("dd/mm/aaaa") en vez de la fecha gris del navegador.
 */
export function Input({
  etiqueta, ayuda, error, tamano, etiquetaOculta, claseCampo, icono, accion, id: idPropio, required, 'aria-describedby': db, ref,
  type, placeholder, onChange, ...resto
}: InputProps & { ref?: Ref<HTMLInputElement> }) {
  const c = useCampo(idPropio, { ayuda, error }, db)
  const placeholderFecha = type ? TIPOS_FECHA[type] : undefined
  const esFecha = placeholderFecha !== undefined
  const elemento = useRef<HTMLInputElement | null>(null)

  const marcarVacio = useCallback(() => {
    const el = elemento.current
    if (el && esFecha) el.dataset.vacio = el.value ? 'false' : 'true'
  }, [esFecha])
  // Sincroniza en cada render: cubre valores controlados, defaultValue y reset() de React Hook Form.
  useEffect(marcarVacio)

  const refCombinado = useCallback((el: HTMLInputElement | null) => {
    elemento.current = el
    asignarRef(ref, el)
    marcarVacio()
  }, [ref, marcarVacio])

  return (
    <Envoltura etiqueta={etiqueta} ayuda={ayuda} error={error} requerido={required} tamano={tamano} etiquetaOculta={etiquetaOculta} claseCampo={claseCampo} {...c}>
      <div className={clsx('ui-campo__control', icono && 'ui-campo__control--icono', accion && 'ui-campo__control--accion')}>
        {icono && <span className="ui-campo__icono" aria-hidden>{icono}</span>}
        <input
          ref={refCombinado}
          type={type}
          required={required}
          placeholder={esFecha ? undefined : placeholder}
          onChange={(e) => {
            marcarVacio()
            onChange?.(e)
          }}
          {...c.aria}
          {...resto}
        />
        {esFecha && <span className="ui-campo__placeholder" aria-hidden>{placeholder ?? placeholderFecha}</span>}
        {accion && <span className="ui-campo__accion">{accion}</span>}
      </div>
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
  /** Ícono lucide-react al inicio del campo (decorativo). */
  icono?: ReactNode
}

/** Lista desplegable nativa con chevron propio; `placeholder` agrega la opción vacía. */
export function Select({
  etiqueta, ayuda, error, tamano, etiquetaOculta, claseCampo, icono, id: idPropio, required, opciones, placeholder,
  'aria-describedby': db, ...resto
}: SelectProps & { ref?: Ref<HTMLSelectElement> }) {
  const c = useCampo(idPropio, { ayuda, error }, db)
  return (
    <Envoltura etiqueta={etiqueta} ayuda={ayuda} error={error} requerido={required} tamano={tamano} etiquetaOculta={etiquetaOculta} claseCampo={claseCampo} {...c}>
      <div className={clsx('ui-campo__control ui-campo__select', icono && 'ui-campo__control--icono')}>
        {icono && <span className="ui-campo__icono" aria-hidden>{icono}</span>}
        <select required={required} {...c.aria} {...resto}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {opciones.map((o) => (
            <option key={o.valor} value={o.valor}>{o.texto}</option>
          ))}
        </select>
        <ChevronDown className="ui-campo__chevron" size={16} strokeWidth={2.25} aria-hidden />
      </div>
    </Envoltura>
  )
}

export type TextareaProps = BaseCampo & TextareaHTMLAttributes<HTMLTextAreaElement>

/** Área de texto con etiqueta, ayuda y error; crece verticalmente. */
export function Textarea({
  etiqueta, ayuda, error, tamano, etiquetaOculta, claseCampo, id: idPropio, required, 'aria-describedby': db, ...resto
}: TextareaProps & { ref?: Ref<HTMLTextAreaElement> }) {
  const c = useCampo(idPropio, { ayuda, error }, db)
  return (
    <Envoltura etiqueta={etiqueta} ayuda={ayuda} error={error} requerido={required} tamano={tamano} etiquetaOculta={etiquetaOculta} claseCampo={claseCampo} {...c}>
      <textarea required={required} {...c.aria} {...resto} />
    </Envoltura>
  )
}
