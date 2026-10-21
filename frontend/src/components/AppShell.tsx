import clsx from 'clsx'
import { Camera, LogOut } from 'lucide-react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
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
  const cerrarSesion = useAuth((s) => s.cerrarSesion)
  const navigate = useNavigate()
  const permisos = usuario?.permisos ?? []
  const salir = () => {
    cerrarSesion()
    navigate('/login')
  }

  return (
    <div className="lg:flex">
      <NavegacionLateral permisos={permisos} nombre={usuario?.nombre} onSalir={salir} />
      <div className="min-w-0 flex-1">
        <OfflineBanner />
        <header className="topbar nav-chrome">UTM Desk</header>
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
