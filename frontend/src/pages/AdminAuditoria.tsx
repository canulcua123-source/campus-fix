import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight, DoorOpen, History, RefreshCw, ShieldCheck, Tags, UserRound, type LucideIcon } from 'lucide-react'
import { useAuditoria } from '../api/hooks/auditoria'
import { categoriasQuery } from '../api/catalogos'
import { mensajeDeError } from '../api/client'
import { rolesQuery, usuariosQuery } from '../api/usuarios'
import { BarraFiltros, Button, EmptyState, ErrorState, PageHeader, Segmentado, Skeleton } from '../components/ui'
import { formatearFecha } from '../lib/detalle'
import { hoyEnMexico, restarDias } from '../lib/fechas'
import {
  RECURSOS_AUDITORIA,
  type EventoAuditoria,
  type RecursoAuditoria,
  type ResumenAuditoria,
} from '../schemas/auditoria'

const LIMITE = 20

const ETIQUETAS_RECURSO: Record<RecursoAuditoria, string> = { usuarios: 'Usuarios', roles: 'Roles', categorias: 'Categorías', aulas: 'Aulas' }
const RECURSO_CON_ARTICULO: Record<RecursoAuditoria, string> = { usuarios: 'el usuario', roles: 'el rol', categorias: 'la categoría', aulas: 'el aula' }
const ICONO_RECURSO: Record<RecursoAuditoria, LucideIcon> = { usuarios: UserRound, roles: ShieldCheck, categorias: Tags, aulas: DoorOpen }
const VERBO = { crear: 'Creó', editar: 'Editó' } as const
const ETIQUETAS_CAMPO: Record<keyof ResumenAuditoria, string> = {
  rol: 'Rol',
  activo: 'Activo',
  areas: 'Áreas',
  edificios: 'Edificios',
  tipo_reportante: 'Tipo de reportante',
  clave: 'Clave',
  alcance: 'Alcance',
  cantidad_permisos: 'Permisos',
  version: 'Versión',
  activa: 'Activa',
  prefijo: 'Prefijo',
  cantidad_campos: 'Campos',
  sistema: 'De sistema',
  edificio: 'Edificio',
  piso: 'Piso',
  aula: 'Aula',
}

type Valor = ResumenAuditoria[keyof ResumenAuditoria]

/** Nombres legibles tomados de las consultas ya en caché (no dispara peticiones nuevas). */
interface Nombres {
  usuario: (id: string) => string | undefined
  rol: (clave: string) => string | undefined
  categoria: (idOClave: string) => string | undefined
}

const idCorto = (id: string) => (id.length > 8 ? `…${id.slice(-6)}` : id)

function textoValor(valor: Valor, campo?: keyof ResumenAuditoria, nombres?: Nombres): string {
  if (valor === undefined) return '—'
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No'
  if (Array.isArray(valor)) return valor.length ? valor.join(', ') : 'Ninguno'
  if (campo === 'rol' && typeof valor === 'string') return nombres?.rol(valor) ?? valor
  return String(valor)
}

/** Campos del resumen que cambiaron (en creación, todos los de `despues`). */
function cambiosDe(evento: EventoAuditoria) {
  const antes = evento.antes ?? {}
  return (Object.keys(ETIQUETAS_CAMPO) as (keyof ResumenAuditoria)[])
    .filter((campo) => antes[campo] !== undefined || evento.despues[campo] !== undefined)
    .filter((campo) => textoValor(antes[campo]) !== textoValor(evento.despues[campo]))
    .map((campo) => ({ campo, etiqueta: ETIQUETAS_CAMPO[campo], antes: antes[campo], despues: evento.despues[campo] }))
}

function nombreRecurso(evento: EventoAuditoria, nombres: Nombres): string {
  const clave = evento.despues.clave ?? evento.antes?.clave
  if (evento.recurso === 'usuarios') return nombres.usuario(evento.recurso_id) ?? idCorto(evento.recurso_id)
  if (evento.recurso === 'aulas') {
    const { aula, edificio } = evento.despues
    return aula ? (edificio ? `${aula} · ${edificio}` : aula) : idCorto(evento.recurso_id)
  }
  if (evento.recurso === 'roles') return (clave && nombres.rol(clave)) ?? clave ?? idCorto(evento.recurso_id)
  return nombres.categoria(evento.recurso_id) ?? (clave && nombres.categoria(clave)) ?? clave ?? idCorto(evento.recurso_id)
}

const formatoHora = new Intl.DateTimeFormat('es-MX', { timeStyle: 'short', timeZone: 'America/Mexico_City' })
const formatoDiaLargo = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Mexico_City' })
const relativo = new Intl.RelativeTimeFormat('es-MX', { numeric: 'auto' })

function haceCuanto(iso: string, ahora = Date.now()): string {
  const seg = Math.round((new Date(iso).getTime() - ahora) / 1000)
  const abs = Math.abs(seg)
  if (abs < 60) return 'hace un momento'
  if (abs < 3600) return relativo.format(Math.round(seg / 60), 'minute')
  if (abs < 86400) return relativo.format(Math.round(seg / 3600), 'hour')
  if (abs < 86400 * 30) return relativo.format(Math.round(seg / 86400), 'day')
  return relativo.format(Math.round(seg / (86400 * 30)), 'month')
}

function etiquetaDia(dia: string, iso: string, ahora = new Date()): string {
  const hoy = hoyEnMexico(ahora)
  if (dia === hoy) return 'Hoy'
  if (dia === restarDias(hoy, 1)) return 'Ayer'
  const texto = formatoDiaLargo.format(new Date(iso))
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

function agruparPorDia(eventos: EventoAuditoria[]): { dia: string; titulo: string; eventos: EventoAuditoria[] }[] {
  const grupos = new Map<string, EventoAuditoria[]>()
  for (const e of eventos) {
    const dia = hoyEnMexico(new Date(e.fecha))
    grupos.set(dia, [...(grupos.get(dia) ?? []), e])
  }
  return [...grupos.entries()].map(([dia, lista]) => ({ dia, titulo: etiquetaDia(dia, lista[0].fecha), eventos: lista }))
}

function useNombres(): Nombres {
  // enabled: false → solo lee lo que ya cargaron Usuarios, Roles o Categorías.
  const usuarios = useQuery({ ...usuariosQuery(), enabled: false })
  const roles = useQuery({ ...rolesQuery(), enabled: false })
  const categorias = useQuery({ ...categoriasQuery(), enabled: false })
  return useMemo(() => {
    const u = new Map((usuarios.data ?? []).map((x) => [x._id, x.nombre]))
    const r = new Map((roles.data ?? []).map((x) => [x.clave, x.nombre]))
    const c = new Map((categorias.data ?? []).flatMap((x) => [[x._id, x.nombre], [x.clave, x.nombre]] as [string, string][]))
    return { usuario: (id) => u.get(id), rol: (clave) => r.get(clave), categoria: (k) => c.get(k) }
  }, [usuarios.data, roles.data, categorias.data])
}

export default function AdminAuditoria() {
  const [recurso, setRecurso] = useState<RecursoAuditoria | ''>('')
  const [pagina, setPagina] = useState(1)
  const consulta = useAuditoria({ pagina, limite: LIMITE, recurso: recurso || undefined })
  const nombres = useNombres()
  const grupos = useMemo(() => agruparPorDia(consulta.data?.resultados ?? []), [consulta.data])
  const cambiarRecurso = (v: RecursoAuditoria | '') => { setRecurso(v); setPagina(1) }

  return (
    <div className="pila">
      <PageHeader
        titulo="Auditoría"
        subtitulo="Quién cambió usuarios, roles y categorías, y cuándo."
        acciones={<Button variante="secundario" tamano="sm" icono={<RefreshCw size={16} aria-hidden />} cargando={consulta.isFetching && !consulta.isPending}
          textoCargando="Actualizando…" onClick={() => { void consulta.refetch() }}>Actualizar</Button>}
      />

      <BarraFiltros etiqueta="Filtros de auditoría" activos={recurso ? 1 : 0}>
        <Segmentado<RecursoAuditoria | ''> etiqueta="Recurso" tamano="sm" valor={recurso} onCambio={cambiarRecurso}
          opciones={[{ valor: '', texto: 'Todos' }, ...RECURSOS_AUDITORIA.map((valor) => ({ valor, texto: ETIQUETAS_RECURSO[valor] }))]} />
      </BarraFiltros>

      {consulta.isPending ? (
        <ul role="status" aria-label="Cargando eventos de auditoría" className="m-0 flex list-none flex-col gap-4 p-0">
          {Array.from({ length: 4 }, (_, indice) => (
            <li key={indice} className="flex items-center gap-3">
              <Skeleton ancho={36} alto={36} />
              <div className="flex flex-1 flex-col gap-2"><Skeleton ancho="55%" /><Skeleton ancho="30%" /></div>
            </li>
          ))}
        </ul>
      ) : consulta.isError ? (
        <ErrorState mensaje={mensajeDeError(consulta.error)} onReintentar={() => { void consulta.refetch() }} reintentando={consulta.isFetching} />
      ) : consulta.data.total === 0 || consulta.data.resultados.length === 0 ? (
        <EmptyState
          icono={History}
          titulo="Sin eventos de auditoría"
          descripcion={recurso ? `Nadie ha cambiado ${ETIQUETAS_RECURSO[recurso].toLowerCase()} todavía.` : 'Aquí verás cada alta o edición de usuarios, roles, categorías y aulas.'}
          accion={recurso || pagina > 1 ? <Button variante="secundario" tamano="sm" onClick={() => cambiarRecurso('')}>Ver todos</Button> : undefined}
        />
      ) : (
        <>
          <div aria-label="Eventos de auditoría" role="list" className="flex flex-col gap-5">
            {grupos.map((g) => (
              <section key={g.dia} role="listitem" aria-labelledby={`dia-${g.dia}`} className="flex flex-col gap-2">
                <h2 id={`dia-${g.dia}`} className="m-0 text-sm font-semibold text-muted">{g.titulo}</h2>
                <ol className="ui-card m-0 list-none p-0" aria-label={`Eventos de ${g.titulo}`}>
                  {g.eventos.map((evento) => <Evento key={evento._id} evento={evento} nombres={nombres} />)}
                </ol>
              </section>
            ))}
          </div>
          <Paginacion
            pagina={consulta.data.pagina}
            limite={consulta.data.limite}
            total={consulta.data.total}
            enPagina={consulta.data.resultados.length}
            cargando={consulta.isFetching}
            onCambiar={setPagina}
          />
        </>
      )}
    </div>
  )
}

function Evento({ evento, nombres }: { evento: EventoAuditoria; nombres: Nombres }) {
  const cambios = cambiosDe(evento)
  const Icono = ICONO_RECURSO[evento.recurso]
  const actor = nombres.usuario(evento.actor_id) ?? `Admin ${idCorto(evento.actor_id)}`
  return (
    <li aria-label={`${VERBO[evento.accion]} ${RECURSO_CON_ARTICULO[evento.recurso]}`} className="border-b border-line last:border-b-0">
      <details className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-start gap-3 px-4 py-3">
          <span aria-hidden className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-panel-2 text-muted">
            <Icono size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-ink">
              {VERBO[evento.accion]} {RECURSO_CON_ARTICULO[evento.recurso]} <strong className="font-semibold">{nombreRecurso(evento, nombres)}</strong>
            </span>
            <span className="block text-sm text-muted">
              {actor} · <time dateTime={evento.fecha} title={formatearFecha(evento.fecha)}>{haceCuanto(evento.fecha)} · {formatoHora.format(new Date(evento.fecha))}</time>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 self-center text-sm text-muted">
            <span className="hidden sm:inline">{cambios.length ? `${cambios.length} ${cambios.length === 1 ? 'cambio' : 'cambios'}` : 'Detalle'}</span>
            <ChevronDown size={16} aria-hidden className="transition-transform group-open:rotate-180" />
          </span>
        </summary>
        <div className="px-4 pb-3 sm:pl-16">
          {cambios.length === 0 ? (
            <p className="m-0 text-sm text-muted">Sin cambios en los campos de resumen.</p>
          ) : (
            <dl className="m-0 flex flex-col gap-1.5 rounded-lg bg-panel-2 p-3 text-sm" aria-label="Cambios">
              {cambios.map((cambio) => (
                <div key={cambio.campo} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                  <dt className="font-medium text-muted sm:w-36 sm:shrink-0">{cambio.etiqueta}</dt>
                  <dd className="m-0 flex flex-wrap items-center gap-1.5 text-ink">
                    {evento.accion === 'editar' && (
                      <>
                        <span className="text-muted line-through">{textoValor(cambio.antes, cambio.campo, nombres)}</span>
                        <ArrowRight size={14} aria-label="cambia a" className="text-muted" />
                      </>
                    )}
                    <span className="font-medium">{textoValor(cambio.despues, cambio.campo, nombres)}</span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <p className="m-0 mt-2 break-all text-xs text-muted">{formatearFecha(evento.fecha)} · ID {evento.recurso_id}</p>
        </div>
      </details>
    </li>
  )
}

interface PaginacionProps {
  pagina: number
  limite: number
  total: number
  enPagina: number
  cargando: boolean
  onCambiar: (pagina: number) => void
}

function Paginacion({ pagina, limite, total, enPagina, cargando, onCambiar }: PaginacionProps) {
  const desde = (pagina - 1) * limite + 1
  const hasta = (pagina - 1) * limite + enPagina
  if (pagina === 1 && hasta >= total) return <p className="m-0 text-center text-sm text-muted">{total === 1 ? '1 evento' : `${total} eventos`}</p>
  return (
    <nav aria-label="Paginación de auditoría" className="flex flex-wrap items-center justify-between gap-3">
      <p className="m-0 text-sm text-muted" aria-live="polite">{`${desde}–${hasta} de ${total}`}</p>
      <div className="flex gap-2">
        <Button variante="secundario" tamano="sm" icono={<ChevronLeft size={16} aria-hidden />} disabled={pagina <= 1 || cargando}
          onClick={() => onCambiar(pagina - 1)}>Anterior</Button>
        <Button variante="secundario" tamano="sm" disabled={hasta >= total || cargando}
          onClick={() => onCambiar(pagina + 1)}>Siguiente <ChevronRight size={16} aria-hidden /></Button>
      </div>
    </nav>
  )
}
