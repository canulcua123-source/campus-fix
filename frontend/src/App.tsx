import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { RequirePermiso } from './auth/RequirePermiso'
import { AppShell } from './components/AppShell'
import { ACCESO_RUTA as A } from './components/navegacion'
import AdminCategorias from './pages/AdminCategorias'
import AdminRoles from './pages/AdminRoles'
import AdminUsuarios from './pages/AdminUsuarios'
import Bandeja from './pages/Bandeja'
import Buscar from './pages/Buscar'
import Dashboard from './pages/Dashboard'
import DetalleIncidencia from './pages/DetalleIncidencia'
import Inicio from './pages/Inicio'
import Login from './pages/Login'
import MisTickets from './pages/MisTickets'
import MetricasIA from './pages/MetricasIA'
import Perfil from './pages/Perfil'
import Reportar from './pages/Reportar'
import SeccionNoDisponible from './pages/SeccionNoDisponible'

// Guía visual del equipo: solo en desarrollo (Vite elimina este import en producción).
const Estilos = import.meta.env.DEV ? lazy(() => import('./pages/Estilos')) : null

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {Estilos && <Route path="/_estilos" element={<Suspense fallback={null}><Estilos /></Suspense>} />}
      <Route element={<RequirePermiso><AppShell /></RequirePermiso>}>
        {/* Cada guarda usa la matriz ACCESO_RUTA (docs/revision-acceso/pantallas.md). */}
        <Route index element={<Inicio />} />
        <Route path="perfil" element={<Perfil />} />
        <Route path="reportar" element={<RequirePermiso {...A['/reportar']}><Reportar /></RequirePermiso>} />
        <Route path="mis-reportes" element={<RequirePermiso {...A['/mis-reportes']}><MisTickets /></RequirePermiso>} />
        <Route path="mis-tickets" element={<Navigate to="/mis-reportes" replace />} />
        <Route path="incidencias/:id" element={<RequirePermiso {...A['/incidencias/:id']}><DetalleIncidencia /></RequirePermiso>} />
        <Route path="bandeja" element={<RequirePermiso {...A['/bandeja']}><Bandeja /></RequirePermiso>} />
        <Route path="buscar" element={<RequirePermiso {...A['/buscar']}><Buscar /></RequirePermiso>} />
        <Route path="dashboard" element={<RequirePermiso {...A['/dashboard']}><Dashboard /></RequirePermiso>} />
        <Route path="admin/usuarios" element={<RequirePermiso {...A['/admin/usuarios']}><AdminUsuarios /></RequirePermiso>} />
        <Route path="admin/roles" element={<RequirePermiso {...A['/admin/roles']}><AdminRoles /></RequirePermiso>} />
        <Route path="admin/categorias" element={<RequirePermiso {...A['/admin/categorias']}><AdminCategorias /></RequirePermiso>} />
        <Route path="admin/metricas-ia" element={<RequirePermiso {...A['/admin/metricas-ia']}><MetricasIA /></RequirePermiso>} />
        <Route path="*" element={<SeccionNoDisponible />} />
      </Route>
    </Routes>
  )
}
