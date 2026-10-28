import { Navigate } from 'react-router-dom'
import { usePermiso } from '../auth/usePermiso'
import { ACCESO_RUTA } from '../components/navegacion'
import Inicio from './Inicio'

/** «/»: el superadmin aterriza en su Centro de control; el resto ve Inicio. */
export default function InicioPorRol() {
  const esSuperadmin = usePermiso(ACCESO_RUTA['/control'])
  return esSuperadmin ? <Navigate to="/control" replace /> : <Inicio />
}
