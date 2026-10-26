import { LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useLogout } from '../api/hooks/auth'
import { useAuth } from '../auth/store'
import { Button, Card, PageHeader } from '../components/ui'
import { ETIQUETAS_ALCANCE } from '../schemas/etiquetas'

/** Perfil de la sesión actual y cierre de sesión (RF-GEN-02). */
export default function Perfil() {
  const usuario = useAuth((s) => s.usuario)
  const salir = useLogout()
  const navigate = useNavigate()
  if (!usuario) return null

  return (
    <>
      <PageHeader titulo="Perfil" />
      <Card como="section" className="flex flex-col gap-3">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted">Nombre</dt>
            <dd className="font-semibold text-ink">{usuario.nombre}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Rol</dt>
            <dd className="font-semibold text-ink">{usuario.rol}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Alcance</dt>
            <dd className="font-semibold text-ink">{ETIQUETAS_ALCANCE[usuario.alcance]}</dd>
          </div>
        </dl>
        <Button
          variante="secundario"
          icono={<LogOut size={18} aria-hidden />}
          cargando={salir.isPending}
          textoCargando="Cerrando sesión…"
          onClick={() => salir.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) })}
          className="self-start"
        >
          Cerrar sesión
        </Button>
      </Card>
    </>
  )
}
