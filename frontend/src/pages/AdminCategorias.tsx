import { useState, type FormEvent } from 'react'
import { ArrowDown, ArrowUp, Lock, Pencil, Plus, Tags, Trash2 } from 'lucide-react'
import { ApiError, mensajeDeError } from '../api/client'
import { useCategorias, useCrearCategoria, useEditarCategoria } from '../api/hooks/admin'
import { CamposCategoria } from '../components/CamposCategoria'
import { BottomSheet, Button, Card, EmptyState, ErrorState, Input, PageHeader, Select, SkeletonLista, Textarea } from '../components/ui'
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

function ConstructorCampo({ campo, indice, total, errores, bloqueado, onCambio, onMover, onQuitar }: {
  campo: CampoBorrador
  indice: number
  total: number
  errores: Record<string, string>
  bloqueado: boolean
  onCambio: (cambios: Partial<CampoBorrador>) => void
  onMover: (delta: -1 | 1) => void
  onQuitar: () => void
}) {
  const ruta = `campos.${indice}`
  const nombre = campo.nombreEditado ? campo.nombre : normalizarIdentificador(campo.etiqueta)
  return (
    <Card como="li" className="flex flex-col gap-3" aria-label={`Campo ${indice + 1}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 font-semibold text-ink">Campo {indice + 1}</p>
        {!bloqueado && (
          <div className="flex gap-1">
            <Button variante="fantasma" aria-label={`Subir campo ${indice + 1}`} disabled={indice === 0} onClick={() => onMover(-1)}><ArrowUp size={18} aria-hidden /></Button>
            <Button variante="fantasma" aria-label={`Bajar campo ${indice + 1}`} disabled={indice === total - 1} onClick={() => onMover(1)}><ArrowDown size={18} aria-hidden /></Button>
            <Button variante="fantasma" aria-label={`Quitar campo ${indice + 1}`} disabled={total === 1} onClick={onQuitar}><Trash2 size={18} aria-hidden /></Button>
          </div>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input etiqueta="Etiqueta" required disabled={bloqueado} value={campo.etiqueta} placeholder="Ej. Número de serie"
          error={errores[`${ruta}.etiqueta`]} onChange={(e) => onCambio({ etiqueta: e.target.value })} />
        <Input etiqueta="Nombre interno" disabled={bloqueado} value={nombre} ayuda="Se genera de la etiqueta; solo minúsculas, números y _"
          error={errores[`${ruta}.nombre`]} onChange={(e) => onCambio({ nombre: e.target.value, nombreEditado: true })} />
        <Select etiqueta="Tipo" disabled={bloqueado} value={campo.tipo} error={errores[`${ruta}.tipo`]}
          opciones={TIPOS_CAMPO_NUEVO.map((t) => ({ valor: t, texto: ETIQUETAS_TIPO_CAMPO[t] }))}
          onChange={(e) => onCambio({ tipo: e.target.value as TipoCampoNuevo })} />
        <label className="flex min-h-11 items-center gap-2 self-end text-ink">
          <input type="checkbox" style={{ width: 20, minHeight: 20 }} disabled={bloqueado} checked={campo.requerido}
            onChange={(e) => onCambio({ requerido: e.target.checked })} />
          Obligatorio
        </label>
      </div>
      {campo.tipo === 'lista' && (
        <Textarea etiqueta="Opciones" required disabled={bloqueado} rows={3} value={campo.opcionesTexto} ayuda="Una opción por renglón (máx. 50)"
          error={errores[`${ruta}.opciones`] ?? Object.entries(errores).find(([k]) => k.startsWith(`${ruta}.opciones.`))?.[1]}
          onChange={(e) => onCambio({ opcionesTexto: e.target.value })} />
      )}
      {admiteLimites(campo.tipo) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input etiqueta={campo.tipo === 'texto' ? 'Mínimo de caracteres' : 'Valor mínimo'} type="number" inputMode="decimal" disabled={bloqueado}
            value={campo.min} error={errores[`${ruta}.min`]} onChange={(e) => onCambio({ min: e.target.value })} />
          <Input etiqueta={campo.tipo === 'texto' ? 'Máximo de caracteres' : 'Valor máximo'} type="number" inputMode="decimal" disabled={bloqueado}
            value={campo.max} error={errores[`${ruta}.max`]} onChange={(e) => onCambio({ max: e.target.value })} />
        </div>
      )}
    </Card>
  )
}

function VistaPrevia({ borrador }: { borrador: Borrador }) {
  const [valores, setValores] = useState<ValoresDetalle>({})
  const [errores, setErrores] = useState<Record<string, string> | null>(null)
  const campos = definicionPrevia(borrador)
  const definicion = { clave: normalizarIdentificador(borrador.clave || borrador.nombre) || 'nueva', campos }
  return (
    <Card como="section" aria-labelledby="vista-previa" className="flex flex-col gap-3">
      <div>
        <h2 id="vista-previa" className="m-0 text-base font-semibold text-ink">Vista previa del formulario</h2>
        <p className="m-0 text-sm text-muted">Así verá el reporte quien elija esta categoría.</p>
      </div>
      {campos.length === 0 ? (
        <p className="m-0 text-sm text-muted">Escribe la etiqueta de un campo para verlo aquí.</p>
      ) : (
        <>
          <CamposCategoria campos={campos} valores={valores} errores={errores ?? {}}
            onCambio={(n, v) => { setValores((a) => ({ ...a, [n]: v })); setErrores(null) }} />
          <div className="flex flex-wrap items-center gap-3">
            <Button variante="secundario" onClick={() => setErrores(validarDetalle(definicion, valores).errores ?? {})}>Probar validación</Button>
            {errores && Object.keys(errores).length === 0 && <p role="status" className="m-0 text-sm text-ok">Los datos de prueba son válidos.</p>}
          </div>
        </>
      )}
    </Card>
  )
}

export default function AdminCategorias() {
  const categorias = useCategorias()
  const crear = useCrearCategoria()
  const editar = useEditarCategoria()
  const [modo, setModo] = useState<Modo>(null)
  const [borrador, setBorrador] = useState<Borrador>(BORRADOR_VACIO)
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [aviso, setAviso] = useState<string | null>(null)
  const [desactivar, setDesactivar] = useState<CategoriaApi | null>(null)
  const guardando = crear.isPending || editar.isPending
  const bloqueado = modo?.tipo === 'editar' && esCategoriaSistema(modo.categoria)

  const actualizar = (cambios: Partial<Borrador>) => { setBorrador((b) => ({ ...b, ...cambios })); setErrores({}) }
  const actualizarCampo = (uid: number, cambios: Partial<CampoBorrador>) =>
    actualizar({ campos: borrador.campos.map((c) => (c.uid === uid ? { ...c, ...cambios } : c)) })
  const mover = (i: number, delta: -1 | 1) => {
    const campos = [...borrador.campos]
    ;[campos[i], campos[i + delta]] = [campos[i + delta], campos[i]]
    actualizar({ campos })
  }
  const abrir = (m: NonNullable<Modo>) => {
    setModo(m); setBorrador(m.tipo === 'crear' ? BORRADOR_VACIO() : borradorDe(m.categoria)); setErrores({}); setAviso(null)
  }
  const cerrar = () => { setModo(null); setErrores({}) }

  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!modo || guardando) return
    const r = construir(borrador, modo)
    if (!r.ok) { setErrores(r.errores); return }
    try {
      if (modo.tipo === 'crear') await crear.mutateAsync(r.datos as CategoriaIn)
      else await editar.mutateAsync({ clave: modo.categoria.clave, datos: r.datos as CategoriaPatch })
      setAviso(modo.tipo === 'crear' ? 'Categoría creada. Ya se puede elegir al reportar.' : 'Cambios guardados.')
      cerrar()
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.campos).length) setErrores(err.campos)
      else setErrores({ _general: mensajeDeError(err, 'No se pudo guardar la categoría') })
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

  return (
    <div className="flex flex-col gap-4">
      <PageHeader titulo="Categorías" subtitulo="Define los formularios de reporte sin cambiar código" acciones={
        !modo && <Button icono={<Plus size={18} />} onClick={() => abrir({ tipo: 'crear' })}>Nueva categoría</Button>
      } />
      {aviso && <p role="status" className="m-0 rounded-lg border border-line bg-panel p-3 text-ink">{aviso}</p>}

      {modo ? (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <form onSubmit={guardar} noValidate className="flex flex-col gap-4" aria-label={modo.tipo === 'crear' ? 'Nueva categoría' : 'Editar categoría'}>
            <Card como="section" className="flex flex-col gap-3">
              <h2 className="m-0 text-base font-semibold text-ink">{modo.tipo === 'crear' ? 'Nueva categoría' : `Editar ${modo.categoria.nombre}`}</h2>
              {bloqueado && (
                <p className="m-0 flex items-center gap-2 text-sm text-muted"><Lock size={16} aria-hidden /> Categoría del sistema: solo puedes cambiar el nombre y el área.</p>
              )}
              <Input etiqueta="Nombre" required value={borrador.nombre} placeholder="Ej. Laboratorios" error={errores.nombre}
                onChange={(e) => actualizar({ nombre: e.target.value })} />
              <Input etiqueta="Clave" required disabled={modo.tipo === 'editar'} error={errores.clave}
                value={borrador.claveEditada ? borrador.clave : normalizarIdentificador(borrador.nombre)}
                ayuda="Identificador permanente; se genera del nombre" onChange={(e) => actualizar({ clave: e.target.value, claveEditada: true })} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input etiqueta="Prefijo del folio" required maxLength={3} disabled={bloqueado} value={borrador.prefijo} placeholder="LAB"
                  error={errores.prefijo} ayuda="3 letras mayúsculas; aparece en el folio (INC-AAAA-MMDD-LAB-0001)" onChange={(e) => actualizar({ prefijo: e.target.value.toUpperCase() })} />
                <Input etiqueta="Área responsable" required value={borrador.area_responsable} placeholder="Ej. Coordinación de laboratorios"
                  error={errores.area_responsable} onChange={(e) => actualizar({ area_responsable: e.target.value })} />
              </div>
            </Card>

            <section aria-labelledby="constructor" className="flex flex-col gap-3">
              <h2 id="constructor" className="m-0 text-base font-semibold text-ink">Campos del formulario</h2>
              {errorCampos && <p className="campo-error m-0">{errorCampos}</p>}
              <ol className="m-0 flex list-none flex-col gap-3 p-0">
                {borrador.campos.map((c, i) => (
                  <ConstructorCampo key={c.uid} campo={c} indice={i} total={borrador.campos.length} errores={errores} bloqueado={bloqueado}
                    onCambio={(cambios) => actualizarCampo(c.uid, cambios)} onMover={(d) => mover(i, d)}
                    onQuitar={() => actualizar({ campos: borrador.campos.filter((x) => x.uid !== c.uid) })} />
                ))}
              </ol>
              {!bloqueado && (
                <Button variante="secundario" icono={<Plus size={18} />} disabled={borrador.campos.length >= 30}
                  onClick={() => actualizar({ campos: [...borrador.campos, campoVacio()] })}>
                  Agregar campo
                </Button>
              )}
            </section>

            {errores._general && <p role="alert" className="m-0 rounded-lg border border-line bg-panel p-3 text-bad">{errores._general}</p>}
            <div className="flex flex-wrap gap-3">
              <Button type="submit" cargando={guardando} textoCargando="Guardando…">{modo.tipo === 'crear' ? 'Crear categoría' : 'Guardar cambios'}</Button>
              <Button variante="secundario" onClick={cerrar} disabled={guardando}>Cancelar</Button>
            </div>
          </form>
          <VistaPrevia borrador={borrador} />
        </div>
      ) : categorias.isPending ? (
        <SkeletonLista etiqueta="Cargando categorías" />
      ) : categorias.isError ? (
        <ErrorState mensaje={mensajeDeError(categorias.error, 'No se pudieron cargar las categorías')} onReintentar={() => void categorias.refetch()} reintentando={categorias.isFetching} />
      ) : categorias.data.length === 0 ? (
        <EmptyState titulo="Aún no hay categorías" descripcion="Crea la primera para poder reportar con ella." icono={Tags}
          accion={<Button icono={<Plus size={18} />} onClick={() => abrir({ tipo: 'crear' })}>Nueva categoría</Button>} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {categorias.data.map((c) => {
            const sistema = esCategoriaSistema(c)
            return (
              <Card como="li" key={c.clave} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="m-0 font-semibold text-ink">{c.nombre}</p>
                  <p className="m-0 text-sm text-muted">{c.prefijo} · {c.area_responsable} · {c.campos.length} {c.campos.length === 1 ? 'campo' : 'campos'} · versión {c.version}</p>
                  {sistema && <p className="m-0 mt-1 flex items-center gap-1 text-sm text-muted"><Lock size={14} aria-hidden /> Del sistema · no se puede eliminar</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variante="secundario" icono={<Pencil size={16} />} aria-label={`Editar ${c.nombre}`} onClick={() => abrir({ tipo: 'editar', categoria: c })}>Editar</Button>
                  {!sistema && (
                    <Button variante="peligro" icono={<Trash2 size={16} />} aria-label={`Desactivar ${c.nombre}`} onClick={() => setDesactivar(c)}>Desactivar</Button>
                  )}
                </div>
              </Card>
            )
          })}
        </ul>
      )}

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
