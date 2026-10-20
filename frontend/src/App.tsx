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

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
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
