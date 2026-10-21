import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { RequirePermiso } from './auth/RequirePermiso'
import { AppShell } from './components/AppShell'
import AdminCategorias from './pages/AdminCategorias'
import AdminRoles from './pages/AdminRoles'
import Bandeja from './pages/Bandeja'
import Dashboard from './pages/Dashboard'
import Inicio from './pages/Inicio'
import Login from './pages/Login'
import MisTickets from './pages/MisTickets'
import Reportar from './pages/Reportar'

// Guía visual del equipo: solo en desarrollo (Vite elimina este import en producción).
const Estilos = import.meta.env.DEV ? lazy(() => import('./pages/Estilos')) : null

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {Estilos && <Route path="/_estilos" element={<Suspense fallback={null}><Estilos /></Suspense>} />}
      <Route element={<RequirePermiso><AppShell /></RequirePermiso>}>
        <Route index element={<Inicio />} />
        <Route path="reportar" element={<RequirePermiso permiso="incidencias:crear"><Reportar /></RequirePermiso>} />
        <Route path="mis-tickets" element={<RequirePermiso permiso="incidencias:ver"><MisTickets /></RequirePermiso>} />
        <Route path="bandeja" element={<RequirePermiso permiso="seguimiento:registrar"><Bandeja /></RequirePermiso>} />
        <Route path="dashboard" element={<RequirePermiso permiso="analitica:ver"><Dashboard /></RequirePermiso>} />
        <Route path="admin/roles" element={<RequirePermiso permiso="roles:gestionar"><AdminRoles /></RequirePermiso>} />
        <Route path="admin/categorias" element={<RequirePermiso permiso="categorias:gestionar"><AdminCategorias /></RequirePermiso>} />
      </Route>
    </Routes>
  )
}
