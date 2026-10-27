import { useState } from 'react'
import { ArrowRight, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { useAuditoria } from '../api/hooks/auditoria'
import { mensajeDeError } from '../api/client'
import { Button, Card, EmptyState, ErrorState, PageHeader, Select, Skeleton } from '../components/ui'
import { formatearFecha } from '../lib/detalle'
import {
  RECURSOS_AUDITORIA,
  type AccionAuditoria,
  type EventoAuditoria,
  type RecursoAuditoria,
  type ResumenAuditoria,
} from '../schemas/auditoria'

const LIMITE = 20

const ETIQUETAS_RECURSO: Record<RecursoAuditoria, string> = { usuarios: 'Usuarios', roles: 'Roles', categorias: 'Categorías' }
const RECURSO_SINGULAR: Record<RecursoAuditoria, string> = { usuarios: 'Usuario', roles: 'Rol', categorias: 'Categoría' }
const ETIQUETAS_ACCION: Record<AccionAuditoria, string> = { crear: 'Creación', editar: 'Edición' }
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
  prefijo: 'Prefijo',
  cantidad_campos: 'Campos',
  sistema: 'De sistema',
}

type Valor = ResumenAuditoria[keyof ResumenAuditoria]

function textoValor(valor: Valor): string {
  if (valor === undefined) return '—'
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No'
  if (Array.isArray(valor)) return valor.length ? valor.join(', ') : 'Ninguno'
  return String(valor)
}

/** Campos del resumen que cambiaron (en creación, todos los de `despues`). */
function cambiosDe(evento: EventoAuditoria) {
  const antes = evento.antes ?? {}
  const campos = (Object.keys(ETIQUETAS_CAMPO) as (keyof ResumenAuditoria)[])
    .filter((campo) => antes[campo] !== undefined || evento.despues[campo] !== undefined)
  return campos
    .filter((campo) => textoValor(antes[campo]) !== textoValor(evento.despues[campo]))
    .map((campo) => ({ campo, etiqueta: ETIQUETAS_CAMPO[campo], antes: antes[campo], despues: evento.despues[campo] }))
}

export default function AdminAuditoria() {
  const [recurso, setRecurso] = useState<RecursoAuditoria | ''>('')
  const [pagina, setPagina] = useState(1)
  const consulta = useAuditoria({ pagina, limite: LIMITE, recurso: recurso || undefined })

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        titulo="Auditoría"
        subtitulo="Cambios administrativos en usuarios, roles y categorías."
        acciones={<Button variante="secundario" icono={<RefreshCw size={18} aria-hidden />} cargando={consulta.isFetching && !consulta.isPending}
          textoCargando="Actualizando…" onClick={() => { void consulta.refetch() }}>Actualizar</Button>}
      />

      <Card como="section" aria-label="Filtros de auditoría" className="sm:max-w-xs">
        <Select etiqueta="Recurso" value={recurso} placeholder="Todos"
          opciones={RECURSOS_AUDITORIA.map((valor) => ({ valor, texto: ETIQUETAS_RECURSO[valor] }))}
          onChange={(e) => { setRecurso(e.target.value as RecursoAuditoria | ''); setPagina(1) }} />
      </Card>

      {consulta.isPending ? (
        <ul role="status" aria-label="Cargando eventos de auditoría" className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, indice) => (
            <Card como="li" key={indice} className="flex flex-col gap-2">
              <Skeleton ancho="40%" /><Skeleton ancho="70%" /><Skeleton ancho="55%" />
            </Card>
          ))}
        </ul>
      ) : consulta.isError ? (
        <ErrorState mensaje={mensajeDeError(consulta.error)} onReintentar={() => { void consulta.refetch() }} reintentando={consulta.isFetching} />
      ) : consulta.data.total === 0 || consulta.data.resultados.length === 0 ? (
        <EmptyState
          titulo="Sin eventos de auditoría"
          descripcion={recurso ? `No hay cambios registrados en ${ETIQUETAS_RECURSO[recurso].toLowerCase()}.` : 'Aún no se registran cambios administrativos.'}
          accion={recurso || pagina > 1 ? <Button variante="secundario" onClick={() => { setRecurso(''); setPagina(1) }}>Ver todos</Button> : undefined}
        />
      ) : (
        <>
          <ul aria-label="Eventos de auditoría" className="flex flex-col gap-3">
            {consulta.data.resultados.map((evento) => <Evento key={evento._id} evento={evento} />)}
          </ul>
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

function Evento({ evento }: { evento: EventoAuditoria }) {
  const cambios = cambiosDe(evento)
  return (
    <Card como="li" className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] lg:gap-6">
      <div className="flex flex-col gap-1">
        <p className="font-semibold text-ink">
          {ETIQUETAS_ACCION[evento.accion]} · {RECURSO_SINGULAR[evento.recurso]}
        </p>
        <p className="text-sm text-muted"><time dateTime={evento.fecha}>{formatearFecha(evento.fecha)}</time></p>
        <p className="break-all text-xs text-muted">ID: {evento.recurso_id}</p>
        <p className="break-all text-xs text-muted">Por: {evento.actor_id}</p>
      </div>
      {cambios.length === 0 ? (
        <p className="text-sm text-muted">Sin cambios en los campos de resumen.</p>
      ) : (
        <dl className="flex flex-col gap-2 text-sm" aria-label="Cambios">
          {cambios.map((cambio) => (
            <div key={cambio.campo} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
              <dt className="font-medium text-muted sm:w-40 sm:shrink-0">{cambio.etiqueta}</dt>
              <dd className="flex flex-wrap items-center gap-1.5 text-ink">
                {evento.accion === 'editar' && (
                  <>
                    <span className="text-muted line-through">{textoValor(cambio.antes)}</span>
                    <ArrowRight size={14} aria-label="cambia a" className="text-muted" />
                  </>
                )}
                <span>{textoValor(cambio.despues)}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
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
  return (
    <nav aria-label="Paginación de auditoría" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted" aria-live="polite">{`${desde}–${hasta} de ${total}`}</p>
      <div className="flex gap-2">
        <Button variante="secundario" icono={<ChevronLeft size={18} aria-hidden />} disabled={pagina <= 1 || cargando}
          onClick={() => onCambiar(pagina - 1)}>Anterior</Button>
        <Button variante="secundario" icono={<ChevronRight size={18} aria-hidden />} disabled={hasta >= total || cargando}
          onClick={() => onCambiar(pagina + 1)}>Siguiente</Button>
      </div>
    </nav>
  )
}
