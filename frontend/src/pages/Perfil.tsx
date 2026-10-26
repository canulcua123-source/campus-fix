import { LogOut, Moon, ShieldCheck, Sun, SunMoon } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { mensajeDeError } from '../api/client'
import { useLogout, useMe } from '../api/hooks'
import { Button, Card, ErrorState, PageHeader, Segmentado, Skeleton } from '../components/ui'
import { useTema, type Tema } from '../lib/tema'

const ALCANCE: Record<string, string> = {
  propio: 'Solo tus reportes',
  area: 'Tus áreas asignadas',
  edificio: 'Tus edificios asignados',
  global: 'Todo el campus',
}

const legible = (clave: string) => clave.charAt(0).toUpperCase() + clave.slice(1).replaceAll('_', ' ')

/** T-058: datos de la sesión (GET /auth/me), tema claro/oscuro/automático, aviso de privacidad y cierre de sesión. */
export default function Perfil() {
  const me = useMe()
  const cerrarSesion = useLogout()
  const navegar = useNavigate()
  const [tema, setTema] = useTema()

  return (
    <>
      <PageHeader titulo="Perfil" />

      <Card como="section" aria-labelledby="perfil-cuenta">
        <h2 id="perfil-cuenta" className="mb-3 mt-0 text-base font-semibold text-ink">Tu cuenta</h2>
        {me.isPending && (
          <div className="flex flex-col gap-2" role="status" aria-label="Cargando perfil">
            <Skeleton ancho="60%" alto={20} />
            <Skeleton ancho="80%" />
            <Skeleton ancho="40%" />
          </div>
        )}
        {me.isError && (
          <ErrorState mensaje={mensajeDeError(me.error, 'No pudimos cargar tu perfil')} onReintentar={() => void me.refetch()} reintentando={me.isFetching} />
        )}
        {me.isSuccess && (
          <dl className="m-0 grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted">Nombre</dt>
              <dd className="m-0 text-ink">{me.data.nombre}</dd>
            </div>
            {me.data.correo && (
              <div>
                <dt className="text-sm text-muted">Correo</dt>
                <dd className="m-0 break-all text-ink">{me.data.correo}</dd>
              </div>
            )}
            <div>
              <dt className="text-sm text-muted">Rol</dt>
              <dd className="m-0 text-ink">{legible(me.data.rol)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Alcance</dt>
              <dd className="m-0 text-ink">{ALCANCE[me.data.alcance] ?? legible(me.data.alcance)}</dd>
            </div>
          </dl>
        )}
      </Card>

      <Card como="section" className="mt-3" aria-labelledby="perfil-apariencia">
        <h2 id="perfil-apariencia" className="mb-1 mt-0 text-base font-semibold text-ink">Apariencia</h2>
        <p className="mb-3 mt-0 text-sm text-muted">Automático sigue el tema de tu dispositivo.</p>
        <Segmentado<Tema>
          etiqueta="Tema"
          valor={tema}
          onCambio={setTema}
          opciones={[
            { valor: 'claro', texto: 'Claro', icono: <Sun size={16} aria-hidden /> },
            { valor: 'oscuro', texto: 'Oscuro', icono: <Moon size={16} aria-hidden /> },
            { valor: 'auto', texto: 'Automático', icono: <SunMoon size={16} aria-hidden /> },
          ]}
        />
      </Card>

      <Card como="section" className="mt-3" aria-labelledby="perfil-privacidad">
        <h2 id="perfil-privacidad" className="mb-1 mt-0 text-base font-semibold text-ink">Privacidad</h2>
        <p className="mb-3 mt-0 text-sm text-muted">Qué datos usamos y para qué.</p>
        <Link to="/privacidad" className="ui-btn ui-btn--secundario">
          <ShieldCheck size={18} aria-hidden /> Aviso de privacidad
        </Link>
      </Card>

      <div className="mt-6">
        <Button
          variante="peligro"
          bloque
          icono={<LogOut size={18} />}
          onClick={() => { cerrarSesion(); navegar('/login', { replace: true }) }}
        >
          Cerrar sesión
        </Button>
      </div>
    </>
  )
}
