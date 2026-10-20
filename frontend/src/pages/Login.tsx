import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth, type Usuario } from '../auth/store'

export default function Login() {
  const [correo, setCorreo] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const iniciarSesion = useAuth((s) => s.iniciarSesion)
  const navigate = useNavigate()

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setCargando(true)
    setError(null)
    try {
      const r = await api<{ access_token: string; usuario: Usuario }>('/auth/login', { method: 'POST', json: { correo, password } })
      iniciarSesion(r.access_token, r.usuario)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible iniciar sesión')
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4" style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}>
      <h1 className="titulo-pagina text-brand">UTM Desk</h1>
      <p className="mb-4 text-muted">Inicia sesión para reportar y dar seguimiento a incidencias del campus.</p>
      <form onSubmit={enviar} className="card">
        <label className="etiqueta" htmlFor="correo">Correo</label>
        <input id="correo" type="email" autoComplete="username" value={correo} onChange={(e) => setCorreo(e.target.value)} required />
        <label className="etiqueta" htmlFor="password">Contraseña</label>
        <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="campo-error" role="alert">{error}</p>}
        <button className="btn mt-4 w-full" disabled={cargando}>{cargando ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  )
}
