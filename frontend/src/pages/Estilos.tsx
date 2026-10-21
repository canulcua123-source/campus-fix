import { Camera, Moon, MoreHorizontal, Plus, Search, Sun, SunMoon, Trash2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { NavegacionLateral, NavegacionMovil } from '../components/AppShell'
import { perfilDe } from '../components/navegacion'
import {
  Badge, BottomSheet, Button, Card, claseCardInteractiva, EmptyState, ErrorState, ETIQUETAS, Input, PageHeader, Select,
  Skeleton, SkeletonLista, Spinner, Textarea,
} from '../components/ui'

/*
 * Guía visual del equipo (solo desarrollo, ruta /_estilos).
 * Parámetros: ?tema=claro|oscuro  ?plataforma=ios|android|desktop  ?hoja=abierta
 */

type Tema = 'sistema' | 'claro' | 'oscuro'
type Plataforma = 'ios' | 'android' | 'desktop'

// Copia de roles_sistema() de backend/scripts/init_db.py (solo para la vista previa).
const REPORTANTE = ['incidencias:crear', 'incidencias:ver', 'evidencias:subir', 'ia:usar']
const TECNICO = [...REPORTANTE, 'seguimiento:registrar', 'tags:gestionar', 'incidencias:buscar']
const COORDINADOR = [...TECNICO, 'incidencias:asignar', 'analitica:ver']
const DIRECTIVO = ['incidencias:ver', 'incidencias:buscar', 'analitica:ver']
const ADMIN = [...new Set([...COORDINADOR, 'usuarios:gestionar', 'roles:gestionar', 'categorias:gestionar'])]
const ROLES: [string, string[]][] = [
  ['Reportante', REPORTANTE],
  ['Técnico', TECNICO],
  ['Coordinador', COORDINADOR],
  ['Directivo', DIRECTIVO],
  ['Administrador', ADMIN],
]

const COLORES = [
  ['--color-primary', 'Primario'],
  ['--color-secondary', 'Secundario (IA)'],
  ['--color-bg', 'Fondo'],
  ['--color-surface', 'Superficie'],
  ['--color-surface-2', 'Superficie 2'],
  ['--color-border', 'Borde'],
  ['--color-text', 'Texto'],
  ['--color-text-muted', 'Texto secundario'],
  ['--color-success', 'Éxito'],
  ['--color-warning', 'Aviso'],
  ['--color-danger', 'Peligro'],
  ['--color-info', 'Información'],
] as const

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="mb-10" aria-labelledby={`s-${titulo}`}>
      <h2 id={`s-${titulo}`} className="mb-3 text-xl font-bold">{titulo}</h2>
      {children}
    </section>
  )
}

function Fila({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <p className="mb-2 text-sm font-semibold text-muted">{etiqueta}</p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}

function Segmentado<T extends string>({ etiqueta, valor, opciones, onCambio }: {
  etiqueta: string
  valor: T
  opciones: { valor: T; texto: string; icono?: ReactNode }[]
  onCambio: (v: T) => void
}) {
  return (
    <div role="group" aria-label={etiqueta} className="inline-flex gap-1 rounded-input bg-panel-2 p-1">
      {opciones.map((o) => (
        <button
          key={o.valor}
          type="button"
          aria-pressed={valor === o.valor}
          onClick={() => onCambio(o.valor)}
          className={`inline-flex items-center gap-1.5 rounded-input border-0 px-3 text-sm ${valor === o.valor ? 'bg-panel font-semibold text-ink shadow-sm' : 'bg-transparent text-muted'}`}
        >
          {o.icono}
          {o.texto}
        </button>
      ))}
    </div>
  )
}

const TEMA_PARAM: Record<string, Tema> = { claro: 'claro', oscuro: 'oscuro' }
const PLATAFORMAS: Plataforma[] = ['ios', 'android', 'desktop']

export default function Estilos() {
  const [params] = useSearchParams()
  const [tema, setTema] = useState<Tema>(TEMA_PARAM[params.get('tema') ?? ''] ?? 'sistema')
  const [plataforma, setPlataforma] = useState<Plataforma>(() => {
    const p = params.get('plataforma') as Plataforma | null
    return p && PLATAFORMAS.includes(p) ? p : ((document.documentElement.dataset.platform as Plataforma) ?? 'desktop')
  })
  const [hoja, setHoja] = useState(params.get('hoja') === 'abierta')
  const [cargando, setCargando] = useState(false)
  const [rol, setRol] = useState(0)

  useEffect(() => {
    const raiz = document.documentElement
    if (tema === 'sistema') delete raiz.dataset.theme
    else raiz.dataset.theme = tema === 'oscuro' ? 'dark' : 'light'
  }, [tema])

  useEffect(() => {
    document.documentElement.dataset.platform = plataforma
  }, [plataforma])

  const simularCarga = () => {
    setCargando(true)
    setTimeout(() => setCargando(false), 1500)
  }

  return (
    <main className="mx-auto max-w-5xl px-4 pt-[calc(16px+var(--safe-top))] pb-[calc(32px+var(--safe-bottom))]">
      <PageHeader
        titulo="Guía de estilos"
        subtitulo="UTM Desk · components/ui"
        acciones={<Link to="/" className="ui-btn ui-btn--fantasma">Ir a la app</Link>}
      />

      <div className="mb-8 flex flex-wrap gap-3">
        <Segmentado
          etiqueta="Tema"
          valor={tema}
          onCambio={setTema}
          opciones={[
            { valor: 'sistema', texto: 'Sistema', icono: <SunMoon size={16} aria-hidden /> },
            { valor: 'claro', texto: 'Claro', icono: <Sun size={16} aria-hidden /> },
            { valor: 'oscuro', texto: 'Oscuro', icono: <Moon size={16} aria-hidden /> },
          ]}
        />
        <Segmentado
          etiqueta="Plataforma"
          valor={plataforma}
          onCambio={setPlataforma}
          opciones={[
            { valor: 'ios', texto: 'iOS' },
            { valor: 'android', texto: 'Android' },
            { valor: 'desktop', texto: 'Escritorio' },
          ]}
        />
      </div>

      <Seccion titulo="Colores base">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {COLORES.map(([token, nombre]) => (
            <Card key={token} className="flex items-center gap-3 p-3">
              <span className="h-10 w-10 shrink-0 rounded-input border border-line" style={{ background: `var(${token})` }} aria-hidden />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{nombre}</span>
                <code className="block truncate text-xs text-muted">{token}</code>
              </span>
            </Card>
          ))}
        </div>
      </Seccion>

      <Seccion titulo="Insignias">
        <Card>
          {(Object.keys(ETIQUETAS) as (keyof typeof ETIQUETAS)[]).map((tipo) => (
            <Fila key={tipo} etiqueta={tipo === 'categoria' ? 'Categoría' : tipo === 'estado' ? 'Estado' : 'Prioridad'}>
              {Object.keys(ETIQUETAS[tipo]).map((v) => <Badge key={v} tipo={tipo} valor={v} />)}
            </Fila>
          ))}
          <Fila etiqueta="IA y valor desconocido">
            <Badge tipo="ia" />
            <Badge tipo="ia" confianza={0.87} />
            <Badge tipo="estado" valor="reabierta_por_usuario" />
          </Fila>
        </Card>
      </Seccion>

      <Seccion titulo="Botones">
        <Card>
          <Fila etiqueta="Variantes">
            <Button>Primario</Button>
            <Button variante="secundario">Secundario</Button>
            <Button variante="peligro" icono={<Trash2 size={18} />}>Eliminar</Button>
            <Button variante="fantasma">Fantasma</Button>
          </Fila>
          <Fila etiqueta="Deshabilitados">
            <Button disabled>Primario</Button>
            <Button variante="secundario" disabled>Secundario</Button>
            <Button variante="peligro" disabled>Peligro</Button>
            <Button variante="fantasma" disabled>Fantasma</Button>
          </Fila>
          <Fila etiqueta="Cargando">
            <Button cargando textoCargando="Enviando…">Enviar</Button>
            <Button variante="secundario" cargando>Guardar</Button>
            <Button onClick={simularCarga} cargando={cargando} textoCargando="Enviando…">Probar carga</Button>
          </Fila>
          <Fila etiqueta="Tamaños e ícono">
            <Button tamano="lg" icono={<Camera size={20} />}>Tomar foto</Button>
            <Button icono={<Plus size={18} />}>Nuevo</Button>
            <Button variante="secundario" aria-label="Buscar" icono={<Search size={20} />} />
            <Button variante="fantasma" aria-label="Más opciones" icono={<MoreHorizontal size={20} />} />
          </Fila>
          <Fila etiqueta="Bloque (todo el ancho)">
            <Button tamano="lg" bloque>Enviar reporte</Button>
          </Fila>
        </Card>
      </Seccion>

      <Seccion titulo="Campos de formulario">
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <Input etiqueta="Título" placeholder="Ej. Proyector no enciende" ayuda="Máximo 120 caracteres." />
            <Input etiqueta="VLAN" inputMode="numeric" defaultValue="5000" error="La VLAN debe estar entre 1 y 4094" required />
            <Input etiqueta="Correo institucional" type="email" autoComplete="username" disabled defaultValue="ana@utm.edu.mx" />
          </Card>
          <Card>
            <Select
              etiqueta="Categoría"
              placeholder="Elige una categoría"
              opciones={Object.entries(ETIQUETAS.categoria).map(([valor, texto]) => ({ valor, texto }))}
            />
            <Select
              etiqueta="Prioridad"
              defaultValue=""
              placeholder="Elige la prioridad"
              error="Elige una prioridad"
              required
              opciones={Object.entries(ETIQUETAS.prioridad).map(([valor, texto]) => ({ valor, texto }))}
            />
            <Textarea etiqueta="Descripción" placeholder="¿Qué pasó y dónde?" ayuda="Entre más detalle, más rápido se atiende." />
          </Card>
        </div>
      </Seccion>

      <Seccion titulo="Tarjetas">
        <div className="grid gap-3 md:grid-cols-2">
          <Card>
            <p className="m-0 text-xs text-muted">INC-2026-1020-RED-0042</p>
            <p className="my-1 font-semibold">Sin internet en el laboratorio 3</p>
            <p className="m-0 mb-2 text-sm text-muted">Edificio C · hace 2 h</p>
            <div className="flex flex-wrap gap-1.5">
              <Badge tipo="estado" valor="en_proceso" />
              <Badge tipo="prioridad" valor="alta" />
              <Badge tipo="categoria" valor="computo_redes" />
            </div>
          </Card>
          <Link to="/_estilos" className={claseCardInteractiva}>
            <p className="m-0 font-semibold text-ink">Tarjeta interactiva (enlace)</p>
            <p className="m-0 mt-1 text-sm text-muted">Usa claseCardInteractiva en un Link para que el foco y el rol sean reales.</p>
          </Link>
        </div>
      </Seccion>

      <Seccion titulo="Cargando, vacío y error">
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <p className="mb-3 text-sm font-semibold text-muted">Skeleton</p>
            <SkeletonLista filas={2} />
            <div className="mt-3 flex items-center gap-3">
              <Skeleton ancho={40} alto={40} redondo />
              <Skeleton ancho="60%" />
            </div>
          </Card>
          <Card>
            <EmptyState
              titulo="Aún no tienes reportes"
              descripcion="Cuando reportes una falla aparecerá aquí con su estado."
              accion={<Link to="/reportar" className="ui-btn ui-btn--primario"><Camera size={18} aria-hidden /> Reportar</Link>}
            />
          </Card>
          <Card>
            <ErrorState onReintentar={simularCarga} reintentando={cargando} />
          </Card>
        </div>
        <Fila etiqueta="Spinner (solo dentro de botones o zonas pequeñas)">
          <Spinner />
          <Spinner tamano={28} />
        </Fila>
      </Seccion>

      <Seccion titulo="Encabezado de página">
        <Card>
          <PageHeader titulo="Mis reportes" subtitulo="Hola, Ana" acciones={<Button variante="fantasma" aria-label="Buscar" icono={<Search size={22} />} />} />
          <PageHeader titulo="Detalle" atras={{ to: '/_estilos', texto: 'Mis reportes' }} />
          <p className="m-0 text-sm text-muted">
            Cambia la plataforma arriba: iOS = título grande 34 px; Android = 22 px con barra superior; escritorio = 26 px.
          </p>
        </Card>
      </Seccion>

      <Seccion titulo="Hoja inferior">
        <Button variante="secundario" onClick={() => setHoja(true)}>Abrir hoja</Button>
        <BottomSheet
          abierto={hoja}
          onCerrar={() => setHoja(false)}
          titulo="Cambiar estado"
          acciones={
            <>
              <Button variante="secundario" bloque onClick={() => setHoja(false)}>Cancelar</Button>
              <Button bloque onClick={() => setHoja(false)}>Guardar</Button>
            </>
          }
        >
          <Select
            etiqueta="Nuevo estado"
            defaultValue="en_proceso"
            opciones={Object.entries(ETIQUETAS.estado).map(([valor, texto]) => ({ valor, texto }))}
          />
          <Textarea etiqueta="Comentario" placeholder="Opcional" />
        </BottomSheet>
      </Seccion>

      <Seccion titulo="Navegación por rol">
        <p className="mb-3 text-sm text-muted">
          Matriz «Pantallas por rol» de docs/TAREAS.md. El perfil se deduce de los permisos del usuario.
        </p>
        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Rol">
          {ROLES.map(([nombre], i) => (
            <Button key={nombre} aria-pressed={rol === i} variante={rol === i ? 'primario' : 'secundario'} onClick={() => setRol(i)}>
              {nombre}
            </Button>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
          <div>
            <p className="mb-2 text-sm font-semibold text-muted">Barra inferior (&lt; 1024 px) · perfil «{perfilDe(ROLES[rol][1])}»</p>
            <div className="overflow-hidden rounded-card border border-line pt-8">
              <NavegacionMovil permisos={ROLES[rol][1]} estatica />
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-muted">Menú lateral (≥ 1024 px)</p>
            <NavegacionLateral permisos={ROLES[rol][1]} nombre="Perfil" estatica />
          </div>
        </div>
      </Seccion>
    </main>
  )
}
