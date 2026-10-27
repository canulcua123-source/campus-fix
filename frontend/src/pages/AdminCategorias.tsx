import { useState, type CSSProperties, type FormEvent } from 'react'
import clsx from 'clsx'
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CheckCheck, CircleAlert, Eye, Hash, List, ListChecks, Lock, Network, Pencil, Plus, Tags,
  ToggleLeft, Trash2, Type, type LucideIcon,
} from 'lucide-react'
import { ApiError, mensajeDeError } from '../api/client'
import { useCategorias, useCrearCategoria, useEditarCategoria } from '../api/hooks/admin'
import { CamposCategoria } from '../components/CamposCategoria'
import {
  BottomSheet, Button, Card, ETIQUETAS, EmptyState, ErrorState, Input, PageHeader, Seccion, Select, SkeletonLista, Textarea,
} from '../components/ui'
import { validarDetalle, type ValoresDetalle } from '../lib/zodDinamico'
import {
  ETIQUETAS_TIPO_CAMPO, TIPOS_CAMPO_NUEVO, categoriaInSchema, categoriaPatchSchema, esCategoriaSistema, normalizarIdentificador,
  type CampoCategoria, type CategoriaApi, type CategoriaIn, type CategoriaPatch, type TipoCampoNuevo,
} from '../schemas/catalogos'

interface CampoBorrador {
  uid: number
  etiqueta: string
  nombre: string
  /** Si la persona escribió el nombre interno; si no, se deriva de la etiqueta. */
  nombreEditado: boolean
  tipo: TipoCampoNuevo
  requerido: boolean
  opcionesTexto: string
  min: string
  max: string
}

interface Borrador {
  clave: string
  claveEditada: boolean
  nombre: string
  prefijo: string
  area_responsable: string
  campos: CampoBorrador[]
}

type Modo = { tipo: 'crear' } | { tipo: 'editar'; categoria: CategoriaApi } | null

let siguienteUid = 1
const campoVacio = (): CampoBorrador => ({
  uid: siguienteUid++, etiqueta: '', nombre: '', nombreEditado: false, tipo: 'texto', requerido: true, opcionesTexto: '', min: '', max: '',
})
const BORRADOR_VACIO = (): Borrador => ({ clave: '', claveEditada: false, nombre: '', prefijo: '', area_responsable: '', campos: [campoVacio()] })

const admiteLimites = (t: TipoCampoNuevo) => t === 'texto' || t === 'numero' || t === 'entero'

function borradorDe(c: CategoriaApi): Borrador {
  return {
    clave: c.clave, claveEditada: true, nombre: c.nombre, prefijo: c.prefijo, area_responsable: c.area_responsable,
    campos: c.campos.map((campo) => ({
      uid: siguienteUid++,
      etiqueta: campo.etiqueta ?? campo.nombre,
      nombre: campo.nombre,
      nombreEditado: true,
      tipo: (TIPOS_CAMPO_NUEVO as readonly string[]).includes(campo.tipo) ? campo.tipo as TipoCampoNuevo : 'texto',
      requerido: campo.requerido,
      opcionesTexto: (campo.opciones ?? []).join('\n'),
      min: campo.min?.toString() ?? '',
      max: campo.max?.toString() ?? '',
    })),
  }
}

/** Convierte el borrador a la forma de CampoCategoria (sin claves vacías: nunca null). */
function camposDe(b: Borrador) {
  return b.campos.map((c) => {
    const opciones = c.opcionesTexto.split('\n').map((o) => o.trim()).filter(Boolean)
    return {
      nombre: c.nombreEditado ? c.nombre : normalizarIdentificador(c.etiqueta),
      etiqueta: c.etiqueta,
      tipo: c.tipo,
      requerido: c.requerido,
      ...(c.tipo === 'lista' ? { opciones } : {}),
      ...(admiteLimites(c.tipo) && c.min.trim() !== '' ? { min: Number(c.min) } : {}),
      ...(admiteLimites(c.tipo) && c.max.trim() !== '' ? { max: Number(c.max) } : {}),
    }
  })
}

function erroresDe(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const errores: Record<string, string> = {}
  for (const issue of issues) {
    const ruta = issue.path.map(String).join('.') || '_general'
    errores[ruta] ??= issue.message
  }
  return errores
}

/** Arma la entrada de POST o los cambios de PATCH, validados con el Zod espejo de Pydantic. */
function construir(b: Borrador, modo: NonNullable<Modo>):
  { ok: true; datos: CategoriaIn | CategoriaPatch } | { ok: false; errores: Record<string, string> } {
  const campos = camposDe(b)
  if (modo.tipo === 'crear') {
    const r = categoriaInSchema.safeParse({
      clave: b.claveEditada ? b.clave : normalizarIdentificador(b.nombre),
      nombre: b.nombre, prefijo: b.prefijo.toUpperCase(), area_responsable: b.area_responsable, campos,
    })
    return r.success ? { ok: true, datos: r.data } : { ok: false, errores: erroresDe(r.error.issues) }
  }
  const original = modo.categoria
  const sistema = esCategoriaSistema(original)
  const cambios: Record<string, unknown> = {}
  if (b.nombre.trim() !== original.nombre) cambios.nombre = b.nombre
  if (b.area_responsable.trim() !== original.area_responsable) cambios.area_responsable = b.area_responsable
  if (!sistema && b.prefijo.toUpperCase() !== original.prefijo) cambios.prefijo = b.prefijo.toUpperCase()
  if (!sistema && JSON.stringify(camposDe(borradorDe(original))) !== JSON.stringify(campos)) cambios.campos = campos
  const r = categoriaPatchSchema.safeParse(cambios)
  return r.success ? { ok: true, datos: r.data } : { ok: false, errores: erroresDe(r.error.issues) }
}

/** Definición para la vista previa: solo los campos con etiqueta. */
function definicionPrevia(b: Borrador): CampoCategoria[] {
  return camposDe(b)
    .map((c, i) => ({ ...c, nombre: c.nombre || `campo_${i + 1}` }))
    .filter((c) => c.etiqueta.trim() !== '')
}

const ICONOS_TIPO: Record<string, LucideIcon> = {
  texto: Type, numero: Hash, entero: Hash, booleano: ToggleLeft, ip: Network, lista: List, enum: List, lista_texto: ListChecks,
}

type Paso = 'datos' | 'campos' | 'previa'
const PASOS: { id: Paso; titulo: string; descripcion: string }[] = [
  { id: 'datos', titulo: 'Datos', descripcion: 'Nombre y folio' },
  { id: 'campos', titulo: 'Campos', descripcion: 'Qué se pregunta' },
  { id: 'previa', titulo: 'Vista previa', descripcion: 'Cómo se verá' },
]
const pasoDe = (ruta: string): Paso | null => (ruta === '_general' ? null : ruta.startsWith('campos') ? 'campos' : 'datos')

/** Huella del borrador para saber si hay cambios sin guardar. */
const firma = (b: Borrador) => JSON.stringify([b.clave, b.claveEditada, b.nombre, b.prefijo, b.area_responsable, camposDe(b)])

/** Color del prefijo: el de la categoría del sistema o neutro. */
function estiloPrefijo(c: Pick<CategoriaApi, 'clave'>): CSSProperties {
  const token = ETIQUETAS.categoria[c.clave] ? `--categoria-${c.clave.replaceAll('_', '-')}` : '--estado-cerrada'
  return { '--badge-bg': `var(${token}-bg)`, '--badge-text': `var(${token}-text)` } as CSSProperties
}

function primerError(errores: Record<string, string>, ruta: string) {
  return errores[ruta] ?? Object.entries(errores).find(([k]) => k.startsWith(`${ruta}.`))?.[1]
}

function Pasos({ actual, errores, onIr }: { actual: Paso; errores: Record<string, string>; onIr: (p: Paso) => void }) {
  const conError = new Set(Object.keys(errores).map(pasoDe))
  return (
    <ol aria-label="Pasos" className="m-0 grid list-none grid-cols-3 gap-2 p-0">
      {PASOS.map((p, i) => {
        const activo = p.id === actual
        const error = conError.has(p.id)
        return (
          <li key={p.id}>
            <button type="button" onClick={() => onIr(p.id)} aria-current={activo ? 'step' : undefined}
              className={clsx(
                'flex min-h-11 w-full items-center gap-2 rounded-lg border px-2 py-2 text-left transition-colors active:scale-[0.97] sm:px-3',
                activo ? 'border-brand bg-panel' : 'border-line bg-panel-2',
              )}>
              <span aria-hidden className={clsx(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                error ? 'bg-bad text-on-bad' : activo ? 'bg-brand text-on-brand' : 'bg-panel text-muted',
              )}>
                {error ? <CircleAlert size={16} /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className={clsx('block truncate text-sm font-semibold', activo ? 'text-ink' : 'text-muted')}>{p.titulo}</span>
                <span className="hidden truncate text-xs text-muted sm:block">{p.descripcion}</span>
                {error && <span className="sr-only"> (tiene errores)</span>}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

function FilaCampo({ campo, indice, total, error, bloqueado, onEditar, onMover, onQuitar, onRequerido }: {
  campo: CampoBorrador
  indice: number
  total: number
  error?: string
  bloqueado: boolean
  onEditar: () => void
  onMover: (delta: -1 | 1) => void
  onQuitar: () => void
  onRequerido: (v: boolean) => void
}) {
  const Icono = ICONOS_TIPO[campo.tipo] ?? Type
  const nombre = campo.nombreEditado ? campo.nombre : normalizarIdentificador(campo.etiqueta)
  const n = indice + 1
  return (
    <li aria-label={`Campo ${n}`} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-panel-2 text-muted">
        <Icono size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={clsx('m-0 truncate font-semibold', campo.etiqueta ? 'text-ink' : 'text-muted')}>{campo.etiqueta || 'Sin etiqueta'}</p>
        <p className="m-0 truncate text-sm text-muted">
          {ETIQUETAS_TIPO_CAMPO[campo.tipo]}{nombre && ` · ${nombre}`}
        </p>
        {error && <p className="campo-error m-0">{error}</p>}
      </div>
      <div className="flex items-center gap-1">
        <label className="mr-1 flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink">
          <input type="checkbox" className="accent-[var(--color-primary)]" style={{ width: 18, minHeight: 18 }} disabled={bloqueado}
            checked={campo.requerido} onChange={(e) => onRequerido(e.target.checked)} />
          Obligatorio
        </label>
        {bloqueado ? (
          <Lock size={16} aria-label="Campo del sistema" className="text-muted" />
        ) : (
          <>
            <Button variante="fantasma" tamano="sm" aria-label={`Subir campo ${n}`} disabled={indice === 0} onClick={() => onMover(-1)} icono={<ArrowUp size={16} />} />
            <Button variante="fantasma" tamano="sm" aria-label={`Bajar campo ${n}`} disabled={indice === total - 1} onClick={() => onMover(1)} icono={<ArrowDown size={16} />} />
            <Button variante="fantasma" tamano="sm" aria-label={`Editar campo ${n}`} onClick={onEditar} icono={<Pencil size={16} />} />
            <Button variante="fantasma" tamano="sm" aria-label={`Quitar campo ${n}`} disabled={total === 1} onClick={onQuitar} icono={<Trash2 size={16} />} />
          </>
        )}
      </div>
    </li>
  )
}

function EditorCampo({ campo, indice, errores, onCambio }: {
  campo: CampoBorrador
  indice: number
  errores: Record<string, string>
  onCambio: (cambios: Partial<CampoBorrador>) => void
}) {
  const ruta = `campos.${indice}`
  const nombre = campo.nombreEditado ? campo.nombre : normalizarIdentificador(campo.etiqueta)
  return (
    <div className="flex flex-col gap-3">
      <Input etiqueta="Etiqueta" required value={campo.etiqueta} placeholder="Ej. Número de serie" autoFocus
        error={errores[`${ruta}.etiqueta`]} onChange={(e) => onCambio({ etiqueta: e.target.value })} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Select etiqueta="Tipo" value={campo.tipo} error={errores[`${ruta}.tipo`]}
          opciones={TIPOS_CAMPO_NUEVO.map((t) => ({ valor: t, texto: ETIQUETAS_TIPO_CAMPO[t] }))}
          onChange={(e) => onCambio({ tipo: e.target.value as TipoCampoNuevo })} />
        <Input etiqueta="Nombre interno" value={nombre} ayuda="Se genera solo; minúsculas, números y _"
          error={errores[`${ruta}.nombre`]} onChange={(e) => onCambio({ nombre: e.target.value, nombreEditado: true })} />
      </div>
      {campo.tipo === 'lista' && (
        <Textarea etiqueta="Opciones" required rows={4} value={campo.opcionesTexto} ayuda="Una por renglón (máx. 50)"
          error={primerError(errores, `${ruta}.opciones`)} onChange={(e) => onCambio({ opcionesTexto: e.target.value })} />
      )}
      {admiteLimites(campo.tipo) && (
        <div className="grid grid-cols-2 gap-3">
          <Input etiqueta={campo.tipo === 'texto' ? 'Mín. caracteres' : 'Mínimo'} type="number" inputMode="decimal"
            value={campo.min} error={errores[`${ruta}.min`]} onChange={(e) => onCambio({ min: e.target.value })} />
          <Input etiqueta={campo.tipo === 'texto' ? 'Máx. caracteres' : 'Máximo'} type="number" inputMode="decimal"
            value={campo.max} error={errores[`${ruta}.max`]} onChange={(e) => onCambio({ max: e.target.value })} />
        </div>
      )}
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-ink">
        <input type="checkbox" className="accent-[var(--color-primary)]" style={{ width: 20, minHeight: 20 }} checked={campo.requerido}
          onChange={(e) => onCambio({ requerido: e.target.checked })} />
        Obligatorio
      </label>
    </div>
  )
}

function VistaPrevia({ borrador, original }: { borrador: Borrador; original?: CategoriaApi }) {
  const [valores, setValores] = useState<ValoresDetalle>({})
  const [errores, setErrores] = useState<Record<string, string> | null>(null)
  // Las categorías del sistema se previsualizan con su definición real (tipos heredados incluidos).
  const campos = original ? original.campos : definicionPrevia(borrador)
  const definicion = { clave: normalizarIdentificador(borrador.clave || borrador.nombre) || 'nueva', campos }
  return (
    <Seccion titulo="Vista previa del formulario" descripcion="Así lo verá quien reporte con esta categoría. Llénalo para probar.">
      {campos.length === 0 ? (
        <EmptyState compacto icono={Eye} titulo="Nada que mostrar aún" descripcion="Agrega un campo con etiqueta en el paso 2." />
      ) : (
        <div className="contenido-estrecho flex flex-col gap-4">
          <CamposCategoria campos={campos} valores={valores} errores={errores ?? {}}
            onCambio={(n, v) => { setValores((a) => ({ ...a, [n]: v })); setErrores(null) }} />
          <div className="flex flex-wrap items-center gap-3">
            <Button variante="secundario" tamano="sm" icono={<CheckCheck size={16} />}
              onClick={() => setErrores(validarDetalle(definicion, valores).errores ?? {})}>Probar validación</Button>
            {errores && Object.keys(errores).length === 0 && <p role="status" className="m-0 text-sm text-ok">Los datos de prueba son válidos.</p>}
          </div>
        </div>
      )}
    </Seccion>
  )
}

function TarjetaCategoria({ categoria: c, onEditar, onDesactivar }: { categoria: CategoriaApi; onEditar: () => void; onDesactivar: () => void }) {
  const sistema = esCategoriaSistema(c)
  return (
    <Card como="li" className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className="ui-badge shrink-0 font-mono" style={estiloPrefijo(c)}>{c.prefijo}</span>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate text-base font-semibold text-ink">{c.nombre}</h2>
          <p className="m-0 truncate text-sm text-muted">{c.area_responsable}</p>
        </div>
      </div>
      <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        <span className="inline-flex items-center gap-1"><ListChecks size={14} aria-hidden />{c.campos.length} {c.campos.length === 1 ? 'campo' : 'campos'}</span>
        <span>Versión {c.version}</span>
        {sistema && <span className="inline-flex items-center gap-1"><Lock size={14} aria-hidden />Del sistema · no se puede eliminar</span>}
      </p>
      <div className="mt-auto flex flex-wrap gap-2 border-t border-line pt-3">
        <Button variante="secundario" tamano="sm" icono={<Pencil size={16} />} aria-label={`Editar ${c.nombre}`} onClick={onEditar}>Editar</Button>
        {!sistema && (
          <Button variante="fantasma" tamano="sm" icono={<Trash2 size={16} />} aria-label={`Desactivar ${c.nombre}`} onClick={onDesactivar}>Desactivar</Button>
        )}
      </div>
    </Card>
  )
}

export default function AdminCategorias() {
  const categorias = useCategorias()
  const crear = useCrearCategoria()
  const editar = useEditarCategoria()
  const [modo, setModo] = useState<Modo>(null)
  const [paso, setPaso] = useState<Paso>('datos')
  const [borrador, setBorrador] = useState<Borrador>(BORRADOR_VACIO)
  const [inicial, setInicial] = useState('')
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [aviso, setAviso] = useState<string | null>(null)
  const [desactivar, setDesactivar] = useState<CategoriaApi | null>(null)
  const [editando, setEditando] = useState<{ uid: number; nuevo: boolean } | null>(null)
  const [descartar, setDescartar] = useState(false)
  const guardando = crear.isPending || editar.isPending
  const bloqueado = modo?.tipo === 'editar' && esCategoriaSistema(modo.categoria)
  const sucio = modo !== null && firma(borrador) !== inicial

  const actualizar = (cambios: Partial<Borrador>) => { setBorrador((b) => ({ ...b, ...cambios })); setErrores({}) }
  const actualizarCampo = (uid: number, cambios: Partial<CampoBorrador>) => {
    setBorrador((b) => ({ ...b, campos: b.campos.map((c) => (c.uid === uid ? { ...c, ...cambios } : c)) }))
    setErrores({})
  }
  const mover = (i: number, delta: -1 | 1) => {
    const campos = [...borrador.campos]
    ;[campos[i], campos[i + delta]] = [campos[i + delta], campos[i]]
    actualizar({ campos })
  }
  const agregarCampo = () => {
    const nuevo = campoVacio()
    actualizar({ campos: [...borrador.campos, nuevo] })
    setEditando({ uid: nuevo.uid, nuevo: true })
  }
  const cerrarEditor = () => {
    // Un campo recién agregado que se deja vacío se descarta.
    if (editando?.nuevo) setBorrador((b) => ({ ...b, campos: b.campos.filter((c) => c.uid !== editando.uid || c.etiqueta.trim() !== '') }))
    setEditando(null)
  }
  const abrir = (m: NonNullable<Modo>) => {
    const b = m.tipo === 'crear' ? BORRADOR_VACIO() : borradorDe(m.categoria)
    setModo(m); setBorrador(b); setInicial(firma(b)); setPaso('datos'); setErrores({}); setAviso(null)
  }
  const cerrar = () => { setModo(null); setErrores({}); setDescartar(false) }
  const cancelar = () => (sucio ? setDescartar(true) : cerrar())

  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!modo || guardando) return
    const r = construir(borrador, modo)
    if (!r.ok) {
      setErrores(r.errores)
      const primero = Object.keys(r.errores).map(pasoDe).find(Boolean)
      if (primero) setPaso(primero)
      return
    }
    try {
      if (modo.tipo === 'crear') await crear.mutateAsync(r.datos as CategoriaIn)
      else await editar.mutateAsync({ clave: modo.categoria.clave, datos: r.datos as CategoriaPatch })
      setAviso(modo.tipo === 'crear' ? 'Categoría creada. Ya se puede elegir al reportar.' : 'Cambios guardados.')
      cerrar()
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.campos).length) {
        setErrores(err.campos)
        const primero = Object.keys(err.campos).map(pasoDe).find(Boolean)
        if (primero) setPaso(primero)
      } else setErrores({ _general: mensajeDeError(err, 'No se pudo guardar la categoría') })
    }
  }

  async function confirmarDesactivar() {
    if (!desactivar) return
    try {
      await editar.mutateAsync({ clave: desactivar.clave, datos: { activa: false } })
      setAviso(`La categoría ${desactivar.nombre} se desactivó.`)
    } catch (err) {
      setAviso(mensajeDeError(err, 'No se pudo desactivar la categoría'))
    }
    setDesactivar(null)
  }

  const errorCampos = errores.campos ?? errores['campos._general']
  const indiceEditando = editando ? borrador.campos.findIndex((c) => c.uid === editando.uid) : -1
  const campoEditando = indiceEditando >= 0 ? borrador.campos[indiceEditando] : null
  const indicePaso = PASOS.findIndex((p) => p.id === paso)

  return (
    <div className="pila">
      <PageHeader
        titulo={modo ? (modo.tipo === 'crear' ? 'Nueva categoría' : `Editar ${modo.categoria.nombre}`) : 'Categorías'}
        subtitulo={modo ? 'Completa los 3 pasos y guarda.' : 'Define los formularios de reporte sin tocar código.'}
        acciones={!modo && <Button tamano="sm" icono={<Plus size={18} />} onClick={() => abrir({ tipo: 'crear' })}>Nueva categoría</Button>}
      />
      {aviso && <p role="status" className="m-0 flex items-center gap-2 rounded-lg border border-line bg-panel p-3 text-ink"><CheckCheck size={18} aria-hidden className="text-ok" />{aviso}</p>}

      {modo ? (
        <form onSubmit={guardar} noValidate className="pila" aria-label={modo.tipo === 'crear' ? 'Nueva categoría' : 'Editar categoría'}>
          <Pasos actual={paso} errores={errores} onIr={setPaso} />
          {bloqueado && (
            <p className="m-0 flex items-center gap-2 rounded-lg border border-line bg-panel-2 p-3 text-sm text-muted">
              <Lock size={16} aria-hidden /> Categoría del sistema: solo puedes cambiar el nombre y el área.
            </p>
          )}

          {paso === 'datos' && (
            <Seccion titulo="1. Datos de la categoría" descripcion="Cómo se llama, su folio y quién la atiende.">
              <div className="contenido-estrecho flex flex-col gap-3">
                <Input etiqueta="Nombre" required value={borrador.nombre} placeholder="Ej. Laboratorios" error={errores.nombre}
                  onChange={(e) => actualizar({ nombre: e.target.value })} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input etiqueta="Prefijo del folio" required maxLength={3} disabled={bloqueado} value={borrador.prefijo} placeholder="LAB"
                    error={errores.prefijo} ayuda={`Folio: INC-AAAA-MMDD-${borrador.prefijo || 'LAB'}-0001`}
                    onChange={(e) => actualizar({ prefijo: e.target.value.toUpperCase() })} />
                  <Input etiqueta="Clave" required disabled={modo.tipo === 'editar'} error={errores.clave}
                    value={borrador.claveEditada ? borrador.clave : normalizarIdentificador(borrador.nombre)}
                    ayuda="Permanente; se genera del nombre" onChange={(e) => actualizar({ clave: e.target.value, claveEditada: true })} />
                </div>
                <Input etiqueta="Área responsable" required value={borrador.area_responsable} placeholder="Ej. Coordinación de laboratorios"
                  error={errores.area_responsable} onChange={(e) => actualizar({ area_responsable: e.target.value })} />
              </div>
            </Seccion>
          )}

          {paso === 'campos' && (
            <Seccion titulo="2. Campos del formulario" sinPadding
              descripcion={bloqueado ? 'Los campos del sistema no se pueden cambiar.' : `${borrador.campos.length} de 30 · ordénalos como deben aparecer.`}
              acciones={!bloqueado && (
                <Button tamano="sm" variante="secundario" icono={<Plus size={16} />} disabled={borrador.campos.length >= 30} onClick={agregarCampo}>
                  Agregar campo
                </Button>
              )}>
              {errorCampos && <p className="campo-error m-0 px-4 pt-3">{errorCampos}</p>}
              <ol className="m-0 list-none p-0">
                {borrador.campos.map((c, i) => (
                  <FilaCampo key={c.uid} campo={c} indice={i} total={borrador.campos.length} bloqueado={bloqueado}
                    error={errores[`campos.${i}.etiqueta`] ?? primerError(errores, `campos.${i}`)}
                    onEditar={() => setEditando({ uid: c.uid, nuevo: false })} onMover={(d) => mover(i, d)}
                    onRequerido={(v) => actualizarCampo(c.uid, { requerido: v })}
                    onQuitar={() => actualizar({ campos: borrador.campos.filter((x) => x.uid !== c.uid) })} />
                ))}
              </ol>
            </Seccion>
          )}

          {paso === 'previa' && <VistaPrevia borrador={borrador} original={bloqueado && modo.tipo === 'editar' ? modo.categoria : undefined} />}

          <div className="flex justify-between gap-3">
            {indicePaso > 0 ? (
              <Button variante="fantasma" tamano="sm" icono={<ArrowLeft size={16} />} onClick={() => setPaso(PASOS[indicePaso - 1].id)}>Atrás</Button>
            ) : <span />}
            {indicePaso < PASOS.length - 1 && (
              <Button variante="secundario" tamano="sm" onClick={() => setPaso(PASOS[indicePaso + 1].id)}>
                Siguiente: {PASOS[indicePaso + 1].titulo} <ArrowRight size={16} aria-hidden />
              </Button>
            )}
          </div>

          {errores._general && <p role="alert" className="m-0 rounded-lg border border-line bg-panel p-3 text-bad">{errores._general}</p>}
          <div className="sticky bottom-[calc(var(--tabbar-height)+var(--safe-bottom)+12px)] z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line-strong bg-panel p-3 lg:bottom-4">
            <p role="status" className="m-0 flex items-center gap-2 text-sm text-muted">
              {sucio ? <><span aria-hidden className="h-2 w-2 rounded-full bg-warn" />Cambios sin guardar</> : 'Sin cambios'}
            </p>
            <div className="flex gap-2">
              <Button variante="fantasma" tamano="sm" onClick={cancelar} disabled={guardando}>Cancelar</Button>
              <Button type="submit" tamano="sm" cargando={guardando} textoCargando="Guardando…" disabled={modo.tipo === 'editar' && !sucio}>
                {modo.tipo === 'crear' ? 'Crear categoría' : 'Guardar cambios'}
              </Button>
            </div>
          </div>
        </form>
      ) : categorias.isPending ? (
        <SkeletonLista etiqueta="Cargando categorías" />
      ) : categorias.isError ? (
        <ErrorState mensaje={mensajeDeError(categorias.error, 'No se pudieron cargar las categorías')} onReintentar={() => void categorias.refetch()} reintentando={categorias.isFetching} />
      ) : categorias.data.length === 0 ? (
        <EmptyState titulo="Aún no hay categorías" descripcion="Crea la primera para poder reportar con ella." icono={Tags}
          accion={<Button icono={<Plus size={18} />} onClick={() => abrir({ tipo: 'crear' })}>Nueva categoría</Button>} />
      ) : (
        <ul aria-label="Categorías" className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
          {categorias.data.map((c) => (
            <TarjetaCategoria key={c.clave} categoria={c} onEditar={() => abrir({ tipo: 'editar', categoria: c })} onDesactivar={() => setDesactivar(c)} />
          ))}
        </ul>
      )}

      <BottomSheet abierto={campoEditando !== null} onCerrar={cerrarEditor}
        titulo={editando?.nuevo ? 'Nuevo campo' : `Campo ${indiceEditando + 1}`}
        acciones={<Button onClick={cerrarEditor}>Listo</Button>}>
        {campoEditando && (
          <EditorCampo campo={campoEditando} indice={indiceEditando} errores={errores}
            onCambio={(cambios) => actualizarCampo(campoEditando.uid, cambios)} />
        )}
      </BottomSheet>

      <BottomSheet abierto={descartar} onCerrar={() => setDescartar(false)} titulo="¿Descartar cambios?" acciones={
        <>
          <Button variante="secundario" onClick={() => setDescartar(false)}>Seguir editando</Button>
          <Button variante="peligro" onClick={cerrar}>Descartar</Button>
        </>
      }>
        <p className="m-0 text-ink">Perderás lo que cambiaste en esta categoría.</p>
      </BottomSheet>

      <BottomSheet abierto={desactivar !== null} onCerrar={() => setDesactivar(null)} titulo="¿Desactivar categoría?" acciones={
        <>
          <Button variante="secundario" onClick={() => setDesactivar(null)}>Cancelar</Button>
          <Button variante="peligro" cargando={editar.isPending} onClick={() => void confirmarDesactivar()}>Desactivar</Button>
        </>
      }>
        <p className="m-0 text-ink">
          {desactivar?.nombre} dejará de aparecer al reportar. Los reportes que ya la usan conservan sus datos.
        </p>
      </BottomSheet>
    </div>
  )
}
