import { Camera, ClipboardList, Home, LayoutDashboard, LogOut, Inbox, Shield, Tags, type LucideIcon } from 'lucide-react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/store'
import { InstallPrompt } from './InstallPrompt'
import { OfflineBanner } from './OfflineBanner'
import { UpdatePrompt } from './UpdatePrompt'

interface Item {
  to: string
  etiqueta: string
  icono: LucideIcon
  permiso?: string
}

const IZQUIERDA: Item[] = [
  { to: '/', etiqueta: 'Inicio', icono: Home },
  { to: '/mis-tickets', etiqueta: 'Mis tickets', icono: ClipboardList, permiso: 'incidencias:ver' },
]
const DERECHA: Item[] = [
  { to: '/bandeja', etiqueta: 'Bandeja', icono: Inbox, permiso: 'seguimiento:registrar' },
  { to: '/dashboard', etiqueta: 'Panel', icono: LayoutDashboard, permiso: 'analitica:ver' },
]
const ADMIN: Item[] = [
  { to: '/admin/roles', etiqueta: 'Roles', icono: Shield, permiso: 'roles:gestionar' },
  { to: '/admin/categorias', etiqueta: 'Categorías', icono: Tags, permiso: 'categorias:gestionar' },
]

export function AppShell() {
  const { usuario, tiene, cerrarSesion } = useAuth()
  const navigate = useNavigate()
  const visibles = (items: Item[]) => items.filter((i) => !i.permiso || tiene(i.permiso))
  const salir = () => {
    cerrarSesion()
    navigate('/login')
  }

  const enlace = (i: Item) => (
    <NavLink key={i.to} to={i.to} end={i.to === '/'}>
      <i.icono size={22} aria-hidden />
      <span>{i.etiqueta}</span>
    </NavLink>
  )

  return (
    <div className="lg:flex">
      <aside className="nav-chrome hidden w-60 shrink-0 border-r border-line bg-panel p-4 lg:sticky lg:top-0 lg:block lg:h-screen">
        <h1 className="mb-6 text-xl font-extrabold text-brand">UTM Desk</h1>
        <nav className="flex flex-col gap-1">
          {[...visibles(IZQUIERDA), ...visibles(DERECHA), ...visibles(ADMIN)].map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              end={i.to === '/'}
              className={({ isActive }) =>
                `flex min-h-11 items-center gap-3 rounded-input px-3 text-ink no-underline ${isActive ? 'bg-panel-2 font-semibold text-brand' : ''}`
              }
            >
              <i.icono size={20} aria-hidden />
              {i.etiqueta}
            </NavLink>
          ))}
          {tiene('incidencias:crear') && (
            <NavLink to="/reportar" className="btn mt-3 no-underline">
              <Camera size={20} aria-hidden /> Reportar
            </NavLink>
          )}
        </nav>
        <div className="mt-8 text-sm text-muted">
          <div>{usuario?.nombre}</div>
          <button className="btn btn-secundario mt-2 w-full" onClick={salir}>
            <LogOut size={18} aria-hidden /> Salir
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <OfflineBanner />
        <header className="topbar nav-chrome">UTM Desk</header>
        <main className="app-main">
          <InstallPrompt />
          <Outlet />
        </main>
      </div>

      <nav className="tabbar nav-chrome" aria-label="Navegación principal">
        {visibles(IZQUIERDA).map(enlace)}
        {tiene('incidencias:crear') && (
          <NavLink to="/reportar" className="reportar flex items-center justify-center" aria-label="Reportar">
            <Camera size={26} aria-hidden />
          </NavLink>
        )}
        {visibles(DERECHA).map(enlace)}
      </nav>
      <UpdatePrompt />
    </div>
  )
}
