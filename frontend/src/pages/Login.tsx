import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { BarChart3, Camera, CircleAlert, Eye, EyeOff, Info, ListChecks, Lock, LogIn, Mail, TriangleAlert } from 'lucide-react'
import { ApiError, mensajeDeError } from '../api/client'
import { useLogin } from '../api/hooks/auth'
import { useAuth } from '../auth/store'
import { InstallPrompt } from '../components/InstallPrompt'
import { accesoDe, cumpleAcceso, rutaInicio } from '../components/navegacion'
import { Button, Input } from '../components/ui'
import { DOMINIO_CORREO } from '../schemas/usuario'

const VENTAJAS = [
  { icono: Camera, titulo: 'Reporta con una foto', texto: 'La IA reconoce la falla y llena el reporte por ti.' },
  { icono: ListChecks, titulo: 'Sigue cada avance', texto: 'Estado, técnico asignado y bitácora en tiempo real.' },
  { icono: BarChart3, titulo: 'Decide con datos', texto: 'Tiempos de resolución y fallas recurrentes por edificio.' },
]

/** Tras este tiempo sin respuesta se explica el arranque en frío del servidor (Render gratuito). */
export const MS_SERVIDOR_LENTO = 5000

type CamposLogin = Partial<Record<'correo' | 'password', string>>

/** Ícono de la PWA (public/logo.svg): el mismo que aparece en la pantalla de inicio del teléfono. */
function Logo() {
  return <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" width={48} height={48} className="size-12 shrink-0 rounded-2xl shadow-sm" />
}

function Marca({ claro = false }: { claro?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <Logo />
      <span className="flex flex-col">
        <span className={`text-xl font-bold tracking-tight ${claro ? '' : 'text-ink'}`}>UTM Desk</span>
        <span className={`text-sm ${claro ? 'opacity-85' : 'text-muted'}`}>Campus Fix</span>
      </span>
    </div>
  )
}

export default function Login() {
  const [correo, setCorreo] = useState('')
  const [password, setPassword] = useState('')
  const [verPassword, setVerPassword] = useState(false)
  const [bloqMayus, setBloqMayus] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errores, setErrores] = useState<CamposLogin>({})
  const [lento, setLento] = useState(false)
  const refCorreo = useRef<HTMLInputElement>(null)
  const refPassword = useRef<HTMLInputElement>(null)
  const entrar = useLogin()
  const usuario = useAuth((s) => s.usuario)
  const aviso = useAuth((s) => s.aviso)
  const navigate = useNavigate()
  const location = useLocation()
  const candidato = (location.state as { desde?: unknown } | null)?.desde
  // Solo rutas internas: evita redirecciones abiertas (`//dominio`).
  const destino = typeof candidato === 'string' && candidato.startsWith('/') && !candidato.startsWith('//') ? candidato : '/'
  const enviando = entrar.isPending

  // Si la API tarda (arranque en frío), se explica la espera en vez de dejar el botón girando sin contexto.
  useEffect(() => {
    if (!enviando) return
    const t = setTimeout(() => setLento(true), MS_SERVIDOR_LENTO)
    return () => {
      clearTimeout(t)
      setLento(false)
    }
  }, [enviando])

  function revisarBloqMayus(e: KeyboardEvent<HTMLInputElement>) {
    if (typeof e.getModifierState === 'function') setBloqMayus(e.getModifierState('CapsLock'))
  }

  function enviar(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setErrores({})
    // Se puede escribir solo el usuario: se completa con el dominio institucional.
    const limpio = correo.trim()
    const correoCompleto = limpio && !limpio.includes('@') ? `${limpio}@${DOMINIO_CORREO}` : correo
    entrar.mutate(
      { correo: correoCompleto, password },
      {
        onSuccess: () => {
          // La ruta previa puede ser de otra cuenta (p. ej. /tablero del coordinador): si no es de este rol, va a su inicio.
          const actual = useAuth.getState().usuario
          const acceso = accesoDe(destino.split('?')[0])
          const permitido = actual && (!acceso || cumpleAcceso(acceso, actual.permisos, actual.rol))
          const final = !actual ? destino : destino === '/' || !permitido ? rutaInicio(actual.permisos, actual.rol) : destino
          navigate(final, { replace: true })
        },
        onError: (err) => {
          // Errores de validación (Zod local o 400 de la API) van bajo su campo; el resto, en el aviso general.
          const campos: CamposLogin = err instanceof ApiError ? { correo: err.campos.correo, password: err.campos.password } : {}
          if (campos.correo || campos.password) {
            setErrores(campos)
            ;(campos.correo ? refCorreo : refPassword).current?.focus()
            return
          }
          setError(mensajeDeError(err, 'No fue posible iniciar sesión'))
        },
      },
    )
  }

  // Sesión restaurada con el refresh silencioso (o ya iniciada): no tiene caso mostrar el formulario.
  if (usuario && !enviando) return <Navigate to={destino} replace />

  return (
    <div className="flex min-h-dvh bg-canvas" style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}>
      {/* Panel de marca: solo en escritorio */}
      <aside className="relative hidden flex-1 flex-col justify-between overflow-hidden bg-brand p-12 text-on-brand lg:flex">
        <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.08]" aria-hidden>
          <defs>
            <pattern id="puntos" width="28" height="28" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.6" fill="currentColor" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#puntos)" />
        </svg>
        <div className="relative">
          <Marca claro />
        </div>
        <div className="relative max-w-md">
          <h2 className="text-4xl font-bold leading-tight tracking-tight">Incidencias del campus, resueltas más rápido.</h2>
          <ul className="mt-10 flex flex-col gap-6">
            {VENTAJAS.map(({ icono: Icono, titulo, texto }) => (
              <li key={titulo} className="flex gap-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-on-brand/15" aria-hidden>
                  <Icono size={22} />
                </span>
                <span>
                  <span className="block font-semibold">{titulo}</span>
                  <span className="block opacity-85">{texto}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm opacity-80">Bases de Datos en la Nube · MongoDB Atlas</p>
      </aside>

      {/* Formulario: en móvil ocupa la pantalla (marca arriba, pie abajo); desde 640 px es una tarjeta centrada. */}
      <main
        className="flex flex-1 flex-col sm:items-center sm:justify-center sm:py-10 lg:max-w-xl lg:bg-panel"
        style={{ paddingLeft: 'calc(16px + var(--safe-left))', paddingRight: 'calc(16px + var(--safe-right))' }}
      >
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col py-6 sm:flex-none sm:rounded-card sm:border sm:border-line sm:bg-panel sm:p-8 sm:shadow-sm lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
          <header className="lg:hidden">
            <Marca />
          </header>

          <div className="flex flex-1 flex-col justify-center py-8 sm:flex-none lg:py-0">
            <h1 className="m-0 text-3xl font-bold tracking-tight text-ink">Inicia sesión</h1>
            <p className="mb-6 mt-2 text-muted">Reporta y da seguimiento a las incidencias del campus.</p>

            {aviso && !error && (
              <p role="status" className="mb-4 mt-0 flex items-start gap-2 rounded-xl border border-note/30 bg-note/10 p-3 text-sm text-ink">
                <Info size={18} className="mt-px shrink-0 text-note" aria-hidden />
                {aviso}
              </p>
            )}

            <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
              <Input
                ref={refCorreo}
                etiqueta="Correo institucional"
                type="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                placeholder={`nombre@${DOMINIO_CORREO}`}
                ayuda={`Termina en @${DOMINIO_CORREO}. Puedes escribir solo tu usuario.`}
                error={errores.correo}
                icono={<Mail size={18} />}
                value={correo}
                onChange={(e) => {
                  setCorreo(e.target.value)
                  if (errores.correo) setErrores((p) => ({ ...p, correo: undefined }))
                }}
                onKeyDown={(e) => {
                  // "Siguiente" del teclado: pasa a la contraseña mientras siga vacía.
                  if (e.key === 'Enter' && !password) {
                    e.preventDefault()
                    refPassword.current?.focus()
                  }
                }}
                required
              />
              <Input
                ref={refPassword}
                etiqueta="Contraseña"
                type={verPassword ? 'text' : 'password'}
                autoComplete="current-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                error={errores.password}
                ayuda={bloqMayus ? (
                  <span role="status" className="flex items-center gap-1 font-medium text-warn">
                    <TriangleAlert size={14} aria-hidden /> Bloq Mayús está activado.
                  </span>
                ) : undefined}
                icono={<Lock size={18} />}
                accion={(
                  <button
                    type="button"
                    onClick={() => setVerPassword((v) => !v)}
                    className="grid min-h-11 min-w-11 place-items-center rounded-input text-muted transition-transform hover:text-ink active:scale-[0.97]"
                    aria-label={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    aria-pressed={verPassword}
                  >
                    {verPassword ? <EyeOff size={20} aria-hidden /> : <Eye size={20} aria-hidden />}
                  </button>
                )}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  if (errores.password) setErrores((p) => ({ ...p, password: undefined }))
                }}
                onKeyDown={revisarBloqMayus}
                onKeyUp={revisarBloqMayus}
                onBlur={() => setBloqMayus(false)}
                required
              />

              {error && (
                <p role="alert" className="m-0 flex items-start gap-2 rounded-xl border border-bad/30 bg-bad/10 p-3 text-sm text-bad">
                  <CircleAlert size={18} className="mt-px shrink-0" aria-hidden />
                  {error}
                </p>
              )}

              <Button type="submit" tamano="lg" bloque cargando={enviando} textoCargando="Entrando…" icono={<LogIn size={18} aria-hidden />}>
                Entrar
              </Button>
              <p role="status" className="m-0 min-h-5 text-center text-sm text-muted">
                {lento ? 'Despertando el servidor, puede tardar hasta un minuto…' : ''}
              </p>
            </form>
          </div>

          <footer className="flex flex-col gap-3 text-center text-sm text-muted sm:mt-6">
            <p className="m-0">¿Olvidaste tu contraseña o no puedes entrar? Contacta a la administración del sistema.</p>
            <InstallPrompt />
          </footer>
        </div>
      </main>
    </div>
  )
}
