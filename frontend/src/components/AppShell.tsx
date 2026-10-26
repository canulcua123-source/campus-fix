import clsx from 'clsx'
import { Camera, LogOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useLogout } from '../api/hooks/auth'
import { useAuth } from '../auth/store'
import { InstallPrompt } from './InstallPrompt'
import { navegacionPara, PERFIL_ITEM, REPORTAR, type ItemNav } from './navegacion'
import { OfflineBanner } from './OfflineBanner'
import { UpdatePrompt } from './UpdatePrompt'

/** Barra inferior (< 1024 px). `estatica` la pinta en el flujo (para /_estilos). */
export function NavegacionMovil({ permisos, estatica = false }: { permisos: readonly string[]; estatica?: boolean }) {
  const { movil } = navegacionPara(permisos)
  return (
    <nav className={clsx('tabbar nav-chrome', estatica && 'tabbar--estatica')} aria-label="Navegación principal">
      {movil.map((i) =>
        i === REPORTAR ? (
          <NavLink key={i.to} to={i.to} className="tabbar__camara" aria-label="Reportar incidencia">
            <Camera size={26} aria-hidden />
          </NavLink>
        ) : (
          <NavLink key={i.to + i.etiqueta} to={i.to} end={i.to === '/'} className="tabbar__item">
            <i.icono size={22} aria-hidden />
            <span>{i.etiqueta}</span>
          </NavLink>
        ),
      )}
    </nav>
  )
}

const itemLateral = (i: ItemNav) => (
  <NavLink key={i.to + i.etiqueta} to={i.to} end={i.to === '/'} className="sidebar__item">
    <i.icono size={20} aria-hidden />
    {i.etiqueta}
  </NavLink>
)

function BuscadorGlobal() {
  const navigate = useNavigate()
  const ubicacion = useLocation()
  const [busqueda, setBusqueda] = useState(() => new URLSearchParams(ubicacion.search).get('q') ?? '')

  // Sincroniza el texto con la URL solo ante navegación externa (menú, atrás/adelante); nunca pisa lo que se está escribiendo.
  useEffect(() => {
    if (ubicacion.pathname !== '/buscar') return
    const q = (new URLSearchParams(ubicacion.search).get('q') ?? '').trim()
    setBusqueda((previo) => {
      if (previo.trim() === q) return previo
      return q === '' && previo.trim().length < 2 ? previo : q
    })
  }, [ubicacion.pathname, ubicacion.search])

  useEffect(() => {
    const termino = busqueda.trim()
    if (termino.length < 2) return
    const destino = `/buscar?q=${encodeURIComponent(termino)}`
    if (`${ubicacion.pathname}${ubicacion.search}` === destino) return
    const temporizador = window.setTimeout(() => navigate(destino), 300)
    return () => window.clearTimeout(temporizador)
  }, [busqueda, navigate, ubicacion.pathname, ubicacion.search])

  return (
    <form
      role="search"
      className="ml-auto flex min-w-[min(100%,18rem)] flex-1 gap-2 sm:max-w-md"
      onSubmit={(evento) => {
        evento.preventDefault()
        const termino = busqueda.trim()
        if (termino.length >= 2) navigate(`/buscar?q=${encodeURIComponent(termino)}`)
      }}
    >
      <label className="sr-only" htmlFor="busqueda-global">Buscar incidencias</label>
      <input
        id="busqueda-global"
        type="search"
        value={busqueda}
        onChange={(evento) => {
          const valor = evento.target.value
          setBusqueda(valor)
          if (valor.trim().length < 2 && ubicacion.pathname === '/buscar') navigate('/buscar', { replace: true })
        }}
        placeholder="Buscar incidencias"
        autoComplete="off"
      />
    </form>
  )
}

/** Menú lateral (≥ 1024 px). */
export function NavegacionLateral({
  permisos,
  nombre,
  onSalir,
  estatica = false,
}: {
  permisos: readonly string[]
  nombre?: string
  onSalir?: () => void
  estatica?: boolean
}) {
  const { lateral, puedeReportar } = navegacionPara(permisos)
  return (
    <aside className={clsx('sidebar nav-chrome', estatica && 'sidebar--estatica')} aria-label="Menú lateral">
      <div className="sidebar__marca">
        <span className="sidebar__logo" aria-hidden>UD</span>
        UTM Desk
      </div>
      {puedeReportar && (
        <NavLink to={REPORTAR.to} className="ui-btn ui-btn--primario mb-3">
          <Camera size={20} aria-hidden /> Reportar
        </NavLink>
      )}
      <nav className="flex flex-col gap-1" aria-label="Secciones">
        {lateral.map(itemLateral)}
      </nav>
      <div className="sidebar__pie">
        {itemLateral({ ...PERFIL_ITEM, etiqueta: nombre ?? PERFIL_ITEM.etiqueta })}
        {onSalir && (
          <button type="button" className="sidebar__item w-full border-0 bg-transparent text-left" onClick={onSalir}>
            <LogOut size={20} aria-hidden /> Salir
          </button>
        )}
      </div>
    </aside>
  )
}

export function AppShell() {
  const usuario = useAuth((s) => s.usuario)
  const logout = useLogout()
  const navigate = useNavigate()
  const permisos = usuario?.permisos ?? []
  const puedeBuscar = permisos.includes('incidencias:buscar')

  const salir = () => {
    if (logout.isPending) return
    logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) })
  }

  return (
    <div className="lg:flex">
      <NavegacionLateral permisos={permisos} nombre={usuario?.nombre} onSalir={salir} />
      <div className="min-w-0 flex-1">
        <OfflineBanner />
        <header className="topbar nav-chrome flex flex-wrap items-center gap-2">
          <span className="font-semibold">UTM Desk</span>
          {puedeBuscar && <BuscadorGlobal />}
        </header>
        <main className="app-main">
          <InstallPrompt />
          <Outlet />
        </main>
      </div>
      <NavegacionMovil permisos={permisos} />
      <UpdatePrompt />
    </div>
  )
}
