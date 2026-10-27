import { Camera, ChevronRight, CircleCheck, ClipboardCheck, ClipboardList, FileText, Send, Wrench } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useIncidencias } from '../api/hooks/incidencias'
import { useAuth } from '../auth/store'
import { TarjetaIncidencia } from '../components/TarjetaIncidencia'
import { Card, EmptyState, ErrorState, Seccion, SkeletonLista, StatGrid, StatTile } from '../components/ui'

const PASOS = [
  { icono: Camera, titulo: 'Toma una foto', texto: 'O llena el reporte sin foto si no puedes tomarla.' },
  { icono: ClipboardCheck, titulo: 'Revisa', texto: 'La IA propone título, categoría y prioridad; tú decides.' },
  { icono: Send, titulo: 'Envía', texto: 'Recibes un folio para seguir el avance.' },
]

function saludo(ahora = new Date()): string {
  const hora = Number(new Intl.DateTimeFormat('es-MX', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Mexico_City' }).format(ahora))
  if (hora < 12) return 'Buenos días'
  if (hora < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

/** Inicio del reportante: acceso directo a Reportar, resumen de sus reportes y los 3 más recientes. */
export default function Inicio() {
  const { usuario, tiene } = useAuth()
  const puedeReportar = tiene('incidencias:crear')
  const puedeVer = tiene('incidencias:ver')
  const propias = useIncidencias({ propias: true })
  const nombre = usuario?.nombre.split(/\s+/)[0] ?? ''

  const lista = propias.data ?? []
  const cuenta = (estado: string) => lista.filter((t) => t.estado === estado).length
  const recientes = [...lista].sort((a, b) => b.fecha_creacion.localeCompare(a.fecha_creacion)).slice(0, 3)
  const cargando = propias.isPending

  return (
    <div className="pila pila--lg">
      <header>
        <p className="m-0 text-muted">{saludo()}</p>
        <h1 className="titulo-pagina !mb-0">Hola, {nombre}</h1>
      </header>

      {puedeReportar && (
        <Link
          to="/reportar"
          className="flex min-h-11 items-center gap-4 rounded-card bg-brand p-5 text-on-brand no-underline shadow-sm transition-transform active:scale-[0.98]"
        >
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-on-brand/15" aria-hidden>
            <Camera size={28} />
          </span>
          <span className="flex-1">
            <span className="block text-lg font-bold">Reportar un problema</span>
            <span className="block text-sm opacity-90">Toma una foto y la IA llena el reporte por ti.</span>
          </span>
          <ChevronRight size={24} aria-hidden />
        </Link>
      )}

      {puedeVer && (
        <>
          {propias.isError ? (
            <ErrorState
              titulo="No pudimos cargar tus reportes"
              onReintentar={() => void propias.refetch()}
              reintentando={propias.isFetching}
            />
          ) : !cargando && lista.length === 0 ? (
            puedeReportar ? (
              <Seccion titulo="Así de fácil es reportar" descripcion="Aún no tienes reportes. Te toma menos de un minuto.">
                <ol className="m-0 grid list-none gap-4 p-0 sm:grid-cols-3">
                  {PASOS.map(({ icono: Icono, titulo, texto }, i) => (
                    <li key={titulo} className="flex items-start gap-3">
                      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-panel-2 text-brand" aria-hidden>
                        <Icono size={22} />
                      </span>
                      <span>
                        <span className="block font-semibold text-ink">{i + 1}. {titulo}</span>
                        <span className="block text-sm text-muted">{texto}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </Seccion>
            ) : (
              <Card><EmptyState compacto titulo="Aún no tienes reportes" icono={ClipboardList} /></Card>
            )
          ) : (
            <>
              <section aria-labelledby="inicio-resumen">
                <h2 id="inicio-resumen" className="mb-3 mt-0 text-base font-semibold text-ink">Tus reportes</h2>
                <StatGrid columnas={3} etiqueta="Resumen de tus reportes">
                  <StatTile etiqueta="Abiertas" valor={cuenta('abierta')} icono={<FileText size={18} />} tono="brand" cargando={cargando} />
                  <StatTile etiqueta="En proceso" valor={cuenta('en_proceso') + cuenta('en_espera')} icono={<Wrench size={18} />} tono="warning" cargando={cargando} />
                  <StatTile
                    etiqueta="Por confirmar"
                    valor={cuenta('resuelta')}
                    icono={<CircleCheck size={18} />}
                    tono="success"
                    pista="Resueltas, falta tu visto bueno"
                    cargando={cargando}
                  />
                </StatGrid>
              </section>

              <section aria-labelledby="inicio-recientes">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 id="inicio-recientes" className="m-0 text-base font-semibold text-ink">Recientes</h2>
                  <Link to="/mis-reportes" className="flex min-h-11 items-center gap-1 text-sm font-semibold text-brand">
                    Ver todos <ChevronRight size={16} aria-hidden />
                  </Link>
                </div>
                {cargando ? (
                  <SkeletonLista filas={3} etiqueta="Cargando tus reportes" />
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-3 p-0">
                    {recientes.map((t) => (
                      <li key={t._id}><TarjetaIncidencia incidencia={t} /></li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  )
}
