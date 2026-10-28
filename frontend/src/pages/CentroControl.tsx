import type { ReactNode } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import {
  AlarmClock, BrainCircuit, CheckCircle2, ChevronRight, CircleAlert, CircleCheck, Clock, Database, FolderOpen, HardDrive,
  History, LayoutDashboard, RefreshCw, Server, Settings, ShieldCheck, Siren, TriangleAlert, Users, type LucideIcon,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { auditoriaQuery } from '../api/auditoria'
import { mensajeDeError } from '../api/client'
import { resumenSistemaQuery, saludSistemaQuery } from '../api/sistema'
import {
  Button, EmptyState, ErrorState, PageHeader, Seccion, Skeleton, SkeletonLista, StatGrid, StatTile, Tabla, claseNumerica,
} from '../components/ui'
import { haceCuanto } from '../lib/tiempo'
import { ETIQUETAS_CATEGORIA } from '../schemas/etiquetas'
import type { EventoAuditoria } from '../schemas/auditoria'
import type { AlertaSistema, ComponenteSalud, EstadoComponente, SaludSistema } from '../schemas/sistema'

const numero = new Intl.NumberFormat('es-MX')

/** Estado de salud: siempre ícono + texto (nunca solo color) con los pares AA de tokens.css. */
const ESTADO_SALUD: Record<EstadoComponente, { texto: string; icono: LucideIcon; token: string }> = {
  ok: { texto: 'Operando', icono: CircleCheck, token: '--estado-resuelta' },
  advertencia: { texto: 'Atención', icono: TriangleAlert, token: '--estado-en-proceso' },
  error: { texto: 'Falla', icono: CircleAlert, token: '--prioridad-critica' },
}
const ESTADO_GLOBAL: Record<SaludSistema['estado'], { texto: string; estado: EstadoComponente }> = {
  ok: { texto: 'Todo opera con normalidad', estado: 'ok' },
  degradado: { texto: 'Servicio degradado', estado: 'advertencia' },
  caido: { texto: 'Servicio caído', estado: 'error' },
}

const ACCESOS: { to: string; etiqueta: string; icono: LucideIcon }[] = [
  { to: '/admin/usuarios', etiqueta: 'Usuarios', icono: Users },
  { to: '/admin/roles', etiqueta: 'Roles', icono: ShieldCheck },
  { to: '/admin/configuracion', etiqueta: 'Configuración', icono: Settings },
  { to: '/admin/metricas-ia', etiqueta: 'Métricas IA', icono: BrainCircuit },
  { to: '/dashboard', etiqueta: 'Dashboard', icono: LayoutDashboard },
  { to: '/admin/auditoria', etiqueta: 'Auditoría', icono: History },
]

const RECURSO = { usuarios: 'un usuario', roles: 'un rol', categorias: 'una categoría', aulas: 'un aula' } as const
const VERBO = { crear: 'Creó', editar: 'Editó' } as const

function InsigniaEstado({ estado, texto }: { estado: EstadoComponente; texto?: string }) {
  const { texto: base, icono: Icono, token } = ESTADO_SALUD[estado]
  return (
    <span className="ui-badge" style={{ '--badge-bg': `var(${token}-bg)`, '--badge-text': `var(${token}-text)` } as React.CSSProperties}>
      <Icono size={12} aria-hidden />
      {texto ?? base}
    </span>
  )
}

function uptime(segundos: number): string {
  const dias = Math.floor(segundos / 86_400)
  const horas = Math.floor((segundos % 86_400) / 3_600)
  const minutos = Math.floor((segundos % 3_600) / 60)
  if (dias) return `${dias} d ${horas} h`
  if (horas) return `${horas} h ${minutos} min`
  return `${minutos} min`
}

function FilaSalud({ icono: Icono, nombre, componente, extra }: {
  icono: LucideIcon; nombre: string; componente: ComponenteSalud; extra?: ReactNode
}) {
  return (
    <li className="flex items-start gap-3 py-3">
      <Icono size={20} aria-hidden className="mt-0.5 shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink">{nombre}</span>
          <InsigniaEstado estado={componente.estado} />
        </div>
        <p className="m-0 text-sm text-muted">
          {componente.detalle}
          {componente.latencia_ms !== undefined && ` · ${numero.format(componente.latencia_ms)} ms`}
        </p>
        {extra}
      </div>
    </li>
  )
}

function SaludPanel({ consulta }: { consulta: UseQueryResult<SaludSistema> }) {
  if (consulta.isPending) return <div role="status" aria-label="Cargando salud del sistema"><Skeleton alto={220} /></div>
  if (consulta.isError) {
    return <ErrorState compacto mensaje={mensajeDeError(consulta.error)} onReintentar={() => { void consulta.refetch() }} reintentando={consulta.isFetching} />
  }
  const s = consulta.data
  const global = ESTADO_GLOBAL[s.estado]
  const cupo = s.ia.limite_diario !== undefined && s.ia.usados_hoy !== undefined
    ? `Cupo de hoy: ${numero.format(s.ia.usados_hoy)} de ${numero.format(s.ia.limite_diario)} (${numero.format(s.ia.porcentaje_cupo ?? 0)} %)`
    : 'Cupo de hoy no disponible'
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <InsigniaEstado estado={global.estado} texto={global.texto} />
        <span className="text-sm text-muted">Versión {s.version} · activo hace {uptime(s.uptime_segundos)}</span>
      </div>
      <ul className="m-0 list-none divide-y divide-line p-0">
        <FilaSalud icono={Database} nombre="Base de datos (MongoDB)" componente={s.mongo} />
        <FilaSalud icono={Server} nombre="Caché y cupos (Redis)" componente={s.redis} />
        <FilaSalud icono={HardDrive} nombre="Almacenamiento de evidencias" componente={s.almacenamiento} />
        <FilaSalud
          icono={BrainCircuit} nombre={`IA (${s.ia.proveedor} · ${s.ia.modelo})`} componente={s.ia}
          extra={<p className="m-0 text-sm text-muted">{cupo}</p>}
        />
      </ul>
    </div>
  )
}

function Alertas({ alertas }: { alertas: AlertaSistema[] }) {
  if (alertas.length === 0) {
    return <EmptyState compacto icono={CheckCircle2} titulo="Todo en orden" descripcion="No hay alertas: la operación y el sistema están al día." />
  }
  return (
    <ul className="m-0 list-none divide-y divide-line p-0">
      {alertas.map((a) => (
        <li key={a.tipo}>
          <Link to={a.enlace} className="flex min-h-11 items-center gap-3 px-4 py-3 text-ink no-underline hover:bg-panel-2 lg:px-5">
            {a.severidad === 'critica'
              ? <Siren size={20} aria-hidden className="shrink-0 text-bad" />
              : <TriangleAlert size={20} aria-hidden className="shrink-0 text-warn" />}
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2 font-semibold">
                {a.titulo}
                <span className="ui-badge" style={{
                  '--badge-bg': `var(${a.severidad === 'critica' ? '--prioridad-critica' : '--estado-en-proceso'}-bg)`,
                  '--badge-text': `var(${a.severidad === 'critica' ? '--prioridad-critica' : '--estado-en-proceso'}-text)`,
                } as React.CSSProperties}>{a.severidad === 'critica' ? 'Crítica' : 'Advertencia'} · {numero.format(a.total)}</span>
              </span>
              <span className="block text-sm text-muted">{a.detalle}</span>
            </span>
            <ChevronRight size={18} aria-hidden className="shrink-0 text-muted" />
          </Link>
        </li>
      ))}
    </ul>
  )
}

function TablaConteo({ etiqueta, columna, filas }: { etiqueta: string; columna: string; filas: { clave: string; texto: string; total: number }[] }) {
  return (
    <Tabla etiqueta={etiqueta} densa>
      <thead><tr><th scope="col">{columna}</th><th scope="col" className={claseNumerica}>Incidencias</th></tr></thead>
      <tbody>
        {filas.map((f) => (
          <tr key={f.clave}><th scope="row">{f.texto}</th><td className={claseNumerica}>{numero.format(f.total)}</td></tr>
        ))}
      </tbody>
    </Tabla>
  )
}

function textoEvento(e: EventoAuditoria): string {
  const nombre = e.despues.clave ?? e.despues.aula ?? (e.despues.rol ? `con rol ${e.despues.rol}` : '')
  return `${VERBO[e.accion]} ${RECURSO[e.recurso]}${nombre ? ` ${nombre}` : ''}`
}

export default function CentroControl() {
  const salud = useQuery(saludSistemaQuery())
  const resumen = useQuery(resumenSistemaQuery())
  const actividad = useQuery(auditoriaQuery({ limite: 10 }))
  const consultas = [salud, resumen, actividad]
  const actualizando = consultas.some((c) => c.isFetching && !c.isPending)
  const kpis = resumen.data?.kpis

  const KPIS: { etiqueta: string; valor: string; icono: ReactNode; tono: 'brand' | 'danger' | 'warning' | 'success' | 'neutral'; pista: string }[] = [
    { etiqueta: 'Abiertas', valor: kpis ? numero.format(kpis.abiertas) : '', icono: <FolderOpen />, tono: 'brand', pista: 'Activas en el campus' },
    { etiqueta: 'Sin asignar', valor: kpis ? numero.format(kpis.criticas_sin_asignar) : '', icono: <Siren />, tono: 'danger', pista: 'Críticas sin técnico' },
    { etiqueta: 'Vencidas', valor: kpis ? numero.format(kpis.vencidas) : '', icono: <AlarmClock />, tono: 'warning', pista: 'Más de 24 h activas' },
    {
      etiqueta: 'Resueltas hoy', valor: kpis ? numero.format(kpis.resueltas_hoy) : '', icono: <CheckCircle2 />, tono: 'success',
      pista: kpis ? `${numero.format(kpis.resueltas_semana)} en 7 días` : '',
    },
    {
      etiqueta: 'Resolución prom.', icono: <Clock />, tono: 'neutral', pista: 'Últimos 30 días',
      valor: kpis ? (kpis.horas_resolucion_prom !== undefined ? `${numero.format(kpis.horas_resolucion_prom)} h` : 'Sin datos') : '',
    },
  ]

  return (
    <div className="pila">
      <PageHeader
        titulo="Centro de control"
        subtitulo="Estado del sistema, alertas y operación del campus en un vistazo."
        acciones={(
          <Button
            variante="secundario" tamano="sm" icono={<RefreshCw size={16} aria-hidden />}
            cargando={actualizando} textoCargando="Actualizando…"
            onClick={() => { consultas.forEach((c) => { void c.refetch() }) }}
          >Actualizar</Button>
        )}
      />

      {resumen.isError ? (
        <ErrorState compacto mensaje={mensajeDeError(resumen.error)} onReintentar={() => { void resumen.refetch() }} reintentando={resumen.isFetching} />
      ) : (
        <StatGrid columnas={5} etiqueta="Indicadores principales">
          {KPIS.map((k) => (
            <StatTile key={k.etiqueta} etiqueta={k.etiqueta} valor={k.valor} icono={k.icono} tono={k.tono} pista={k.pista} cargando={resumen.isPending} sobrio />
          ))}
        </StatGrid>
      )}

      {/* Columna izquierda: alertas (crece) + accesos rápidos; así ambas columnas miden lo mismo sin huecos. */}
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <Seccion titulo="Alertas" descripcion="Lo que requiere acción; toca una para ir a resolverla." sinPadding className="flex-1">
            {resumen.isPending ? <SkeletonLista etiqueta="Cargando alertas" />
              : resumen.isError ? <p className="m-0 px-4 py-3 text-sm text-muted lg:px-5">Las alertas no están disponibles mientras el resumen falle.</p>
                : <Alertas alertas={resumen.data.alertas} />}
          </Seccion>
          <Seccion titulo="Accesos rápidos">
            <nav aria-label="Accesos rápidos" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ACCESOS.map(({ to, etiqueta, icono: Icono }) => (
                <Link key={to} to={to} className="ui-btn ui-btn--secundario justify-start">
                  <Icono size={18} aria-hidden />{etiqueta}
                </Link>
              ))}
            </nav>
          </Seccion>
        </div>
        <Seccion titulo="Salud del sistema" descripcion="Se actualiza cada minuto.">
          <SaludPanel consulta={salud} />
        </Seccion>
      </div>

      {resumen.isSuccess && (
        <div className="grid gap-4 xl:grid-cols-3">
          <Seccion titulo="Edificios con más reportes" descripcion="Últimos 30 días." sinPadding>
            {resumen.data.top_edificios.length === 0
              ? <EmptyState compacto titulo="Sin reportes" descripcion="No hay incidencias en los últimos 30 días." />
              : <TablaConteo etiqueta="Edificios con más reportes" columna="Edificio" filas={resumen.data.top_edificios.map((t) => ({ ...t, texto: t.clave }))} />}
          </Seccion>
          <Seccion titulo="Categorías con más reportes" descripcion="Últimos 30 días." sinPadding>
            {resumen.data.top_categorias.length === 0
              ? <EmptyState compacto titulo="Sin reportes" descripcion="No hay incidencias en los últimos 30 días." />
              : <TablaConteo etiqueta="Categorías con más reportes" columna="Categoría" filas={resumen.data.top_categorias.map((t) => ({
                ...t, texto: ETIQUETAS_CATEGORIA[t.clave as keyof typeof ETIQUETAS_CATEGORIA] ?? t.clave,
              }))} />}
          </Seccion>
          <Seccion titulo="Carga de técnicos" descripcion="Incidencias activas asignadas." sinPadding
            acciones={<Link to="/tecnicos" className="text-sm font-semibold text-brand">Ver técnicos</Link>}>
            {resumen.data.carga_tecnicos.length === 0
              ? <EmptyState compacto titulo="Sin asignaciones" descripcion="Ningún técnico tiene incidencias activas." />
              : (
                <Tabla etiqueta="Carga de técnicos" densa>
                  <thead><tr><th scope="col">Técnico</th><th scope="col" className={claseNumerica}>Activas</th><th scope="col" className={claseNumerica}>Horas</th></tr></thead>
                  <tbody>
                    {resumen.data.carga_tecnicos.map((t) => (
                      <tr key={t.tecnico_id}>
                        <th scope="row">{t.nombre}</th>
                        <td className={claseNumerica}>{numero.format(t.incidencias_activas)}</td>
                        <td className={claseNumerica}>{numero.format(t.horas_acumuladas)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Tabla>
              )}
          </Seccion>
        </div>
      )}

      <Seccion titulo="Actividad reciente" descripcion="Últimos 10 cambios administrativos." sinPadding
        acciones={<Link to="/admin/auditoria" className="text-sm font-semibold text-brand">Ver auditoría</Link>}>
        {actividad.isPending ? <SkeletonLista etiqueta="Cargando actividad" />
          : actividad.isError
            ? <ErrorState compacto mensaje={mensajeDeError(actividad.error)} onReintentar={() => { void actividad.refetch() }} reintentando={actividad.isFetching} />
            : actividad.data.resultados.length === 0
              ? <EmptyState compacto icono={History} titulo="Sin actividad" descripcion="Aún no hay cambios administrativos registrados." />
              : (
                <ul className="m-0 list-none divide-y divide-line p-0">
                  {actividad.data.resultados.map((e) => (
                    <li key={e._id} className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-3 lg:px-5">
                      <span className="text-ink">{textoEvento(e)}</span>
                      <time dateTime={e.fecha} className="text-sm text-muted">{haceCuanto(e.fecha)}</time>
                    </li>
                  ))}
                </ul>
              )}
      </Seccion>
    </div>
  )
}
