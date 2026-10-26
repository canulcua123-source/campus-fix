import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BarChart3, Camera, CircleAlert, Eye, EyeOff, ListChecks, LogIn, Wrench } from 'lucide-react'
import { api } from '../api/client'
import { useAuth, type Usuario } from '../auth/store'
import { Button, Input } from '../components/ui'

const VENTAJAS = [
  { icono: Camera, titulo: 'Reporta con una foto', texto: 'La IA reconoce la falla y llena el reporte por ti.' },
  { icono: ListChecks, titulo: 'Sigue cada avance', texto: 'Estado, técnico asignado y bitácora en tiempo real.' },
  { icono: BarChart3, titulo: 'Decide con datos', texto: 'Tiempos de resolución y fallas recurrentes por edificio.' },
]

function Logo({ grande = false }: { grande?: boolean }) {
  const lado = grande ? 'size-14' : 'size-12'
  return (
    <span className={`${lado} grid place-items-center rounded-2xl bg-brand text-on-brand shadow-sm`} aria-hidden>
      <Wrench size={grande ? 28 : 24} strokeWidth={2.2} />
    </span>
  )
}

export default function Login() {
  const [correo, setCorreo] = useState('')
  const [password, setPassword] = useState('')
  const [verPassword, setVerPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const iniciarSesion = useAuth((s) => s.iniciarSesion)
  const aviso = useAuth((s) => s.aviso)
  const navigate = useNavigate()
  const location = useLocation()

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setCargando(true)
    setError(null)
    try {
      const r = await api<{ access_token: string; usuario: Usuario }>('/auth/login', { method: 'POST', json: { correo, password } })
      iniciarSesion(r.access_token, r.usuario)
      const candidato = (location.state as { desde?: unknown } | null)?.desde
      const destino = typeof candidato === 'string' && candidato.startsWith('/') && !candidato.startsWith('//')
        ? candidato
        : '/'
      navigate(destino, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible iniciar sesión')
    } finally {
      setCargando(false)
    }
  }

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
        <div className="relative flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-2xl bg-on-brand/15" aria-hidden>
            <Wrench size={24} strokeWidth={2.2} />
          </span>
          <span className="text-xl font-semibold tracking-tight">UTM Desk</span>
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

      {/* Formulario */}
      <main className="flex flex-1 items-center justify-center px-4 py-10 lg:max-w-xl lg:bg-panel">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center text-center lg:items-start lg:text-left">
            <span className="lg:hidden"><Logo grande /></span>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-ink lg:mt-0">Bienvenido</h1>
            <p className="mt-2 text-muted">Inicia sesión para reportar y dar seguimiento a las incidencias del campus.</p>
          </div>

          <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
            <Input
              etiqueta="Correo institucional"
              type="email"
              inputMode="email"
              autoComplete="username"
              placeholder="nombre@universidad.edu.mx"
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
              required
            />
            <div className="flex flex-col gap-1">
              <Input
                etiqueta="Contraseña"
                type={verPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setVerPassword((v) => !v)}
                className="flex min-h-11 items-center gap-2 self-end rounded-lg px-2 text-sm font-medium text-brand"
                aria-pressed={verPassword}
              >
                {verPassword ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                {verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              </button>
            </div>

            {aviso && !error && (
              <p role="status" className="flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/10 p-3 text-sm text-warn">
                <CircleAlert size={18} className="mt-px shrink-0" aria-hidden />
                {aviso}
              </p>
            )}

            {error && (
              <p role="alert" className="flex items-start gap-2 rounded-xl border border-bad/30 bg-bad/10 p-3 text-sm text-bad">
                <CircleAlert size={18} className="mt-px shrink-0" aria-hidden />
                {error}
              </p>
            )}

            <Button type="submit" tamano="lg" cargando={cargando} icono={<LogIn size={18} aria-hidden />} className="w-full">
              {cargando ? 'Entrando…' : 'Entrar'}
            </Button>
          </form>

          <p className="mt-8 text-center text-sm text-muted">¿Problemas para entrar? Pide a tu coordinación que revise tu cuenta.</p>
        </div>
      </main>
    </div>
  )
}
