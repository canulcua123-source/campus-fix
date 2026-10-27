import { LogOut, Moon, ShieldCheck, Sun, SunMoon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { mensajeDeError } from '../api/client'
import { useLogout, useMe } from '../api/hooks'
import { Button, ErrorState, PageHeader, Seccion, Segmentado, Skeleton } from '../components/ui'
import { ETIQUETAS_PERMISO, ETIQUETAS_TIPO_REPORTANTE } from '../schemas/etiquetas'
import { useTema, type Tema } from '../lib/tema'

const ALCANCE: Record<string, string> = {
  propio: 'Solo tus reportes',
  area: 'Tus áreas asignadas',
  edificio: 'Tus edificios asignados',
  global: 'Todo el campus',
}

const legible = (clave: string) => clave.charAt(0).toUpperCase() + clave.slice(1).replaceAll('_', ' ')
const textoPermiso = (p: string) => (ETIQUETAS_PERMISO as Record<string, string>)[p] ?? legible(p.replace(':', ' '))

function iniciales(nombre: string) {
  return nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted">{etiqueta}</dt>
      <dd className="m-0 break-words text-ink">{children}</dd>
    </div>
  )
}

/** T-058: datos de la sesión (GET /auth/me), tema claro/oscuro/automático, aviso de privacidad y cierre de sesión. */
export default function Perfil() {
  const me = useMe()
  const cerrarSesion = useLogout()
  const navegar = useNavigate()
  const [tema, setTema] = useTema()

  return (
    <div className="contenido-estrecho mx-auto pila">
      <PageHeader titulo="Perfil" />

      <Seccion titulo="Tu cuenta">
        {me.isPending && (
          <div className="flex items-center gap-3" role="status" aria-label="Cargando perfil">
            <Skeleton ancho={56} alto={56} redondo />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton ancho="60%" alto={20} />
              <Skeleton ancho="80%" />
            </div>
          </div>
        )}
        {me.isError && (
          <ErrorState
            compacto
            titulo="No pudimos cargar tu perfil"
            mensaje={mensajeDeError(me.error, 'Revisa tu conexión e inténtalo de nuevo.')}
            onReintentar={() => void me.refetch()}
            reintentando={me.isFetching}
          />
        )}
        {me.isSuccess && (
          <div className="pila">
            <div className="flex items-center gap-3">
              <span className="grid size-14 shrink-0 place-items-center rounded-full bg-brand text-lg font-bold text-on-brand" aria-hidden>
                {iniciales(me.data.nombre)}
              </span>
              <div className="min-w-0">
                <p className="m-0 text-lg font-semibold text-ink">{me.data.nombre}</p>
                {me.data.correo && <p className="m-0 break-all text-sm text-muted">{me.data.correo}</p>}
              </div>
            </div>
            {me.data.tipo_reportante && (
              <dl className="m-0 grid gap-3 sm:grid-cols-2">
                <Dato etiqueta="Tipo de usuario">{ETIQUETAS_TIPO_REPORTANTE[me.data.tipo_reportante]}</Dato>
              </dl>
            )}
          </div>
        )}
      </Seccion>

      {me.isSuccess && (
        <Seccion titulo="Rol y permisos" descripcion="Lo que puedes hacer en UTM Desk.">
          <div className="pila">
            <dl className="m-0 grid gap-3 sm:grid-cols-2">
              <Dato etiqueta="Rol">{legible(me.data.rol)}</Dato>
              <Dato etiqueta="Alcance">{ALCANCE[me.data.alcance] ?? legible(me.data.alcance)}</Dato>
            </dl>
            {me.data.permisos.length > 0 && (
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Permisos">
                {me.data.permisos.map((p) => (
                  <li key={p} className="rounded-full border border-line bg-panel-2 px-3 py-1 text-sm text-ink">{textoPermiso(p)}</li>
                ))}
              </ul>
            )}
          </div>
        </Seccion>
      )}

      <Seccion titulo="Apariencia" descripcion="Automático sigue el tema de tu dispositivo.">
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
      </Seccion>

      <Seccion titulo="Privacidad" descripcion="Qué datos usamos y para qué.">
        <Link to="/privacidad" className="ui-btn ui-btn--secundario">
          <ShieldCheck size={18} aria-hidden /> Aviso de privacidad
        </Link>
      </Seccion>

      <Seccion titulo="Sesión" descripcion="Cierra sesión si usas un equipo compartido.">
        <Button
          variante="peligro"
          bloque
          icono={<LogOut size={18} />}
          cargando={cerrarSesion.isPending}
          textoCargando="Cerrando sesión…"
          onClick={() => cerrarSesion.mutate(undefined, { onSettled: () => navegar('/login', { replace: true }) })}
        >
          Cerrar sesión
        </Button>
      </Seccion>
    </div>
  )
}
