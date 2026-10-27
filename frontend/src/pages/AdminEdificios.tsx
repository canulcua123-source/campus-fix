import { useId, useMemo, useState, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import {
  Building2, Check, ChevronDown, CircleCheck, CircleOff, Copy, DoorOpen, Pencil, Plus, Power, QrCode, Search, SearchX,
} from 'lucide-react'
import { catalogoAulasQuery, useCrearAula, useEditarAula } from '../api/aulas'
import { ApiError, mensajeDeError } from '../api/client'
import { Aviso } from '../components/admin/PiezasAdmin'
import {
  BarraFiltros, BottomSheet, Button, EmptyState, ErrorState, Input, PageHeader, Seccion, Segmentado, SkeletonLista, StatGrid, StatTile,
  Tabla,
} from '../components/ui'
import { aulaInSchema, type AulaCatalogo, type AulaIn, type AulaPatch, type EdificioCatalogo } from '../schemas/aula'

type FiltroEstado = 'todas' | 'activas' | 'inactivas'

/** Aula de una fila con su edificio (el catálogo agrupa por edificio). */
type AulaFila = AulaCatalogo & { edificio: string }
type Formulario = { modo: 'crear' } | { modo: 'editar'; aula: AulaFila }
type Acciones = { onEditar: (a: AulaFila) => void; onCambiarEstado: (a: AulaFila) => void }

const CAMPOS_AULA = ['edificio', 'piso', 'aula', 'activa'] as const
const VACIO: AulaIn = { edificio: '', piso: 0, aula: '', activa: true }

const normalizar = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

const nombrePiso = (piso: number) => (piso === 0 ? 'Planta baja' : piso < 0 ? `Sótano ${-piso}` : `Piso ${piso}`)

/** Si el edificio coincide se muestran todas sus aulas; si no, solo las aulas que coinciden. Luego filtra por estado. */
function filtrar(edificios: EdificioCatalogo[], busqueda: string, estado: FiltroEstado): EdificioCatalogo[] {
  const q = normalizar(busqueda)
  return edificios.flatMap((e) => {
    let aulas = q && !normalizar(e.edificio).includes(q) ? e.aulas.filter((a) => normalizar(a.aula).includes(q)) : e.aulas
    if (estado !== 'todas') aulas = aulas.filter((a) => a.activa === (estado === 'activas'))
    if (!aulas.length && (q || estado !== 'todas')) return []
    return [{ ...e, aulas }]
  })
}

function porPiso(aulas: AulaCatalogo[]): [number, AulaCatalogo[]][] {
  const grupos = new Map<number, AulaCatalogo[]>()
  for (const a of aulas) grupos.set(a.piso, [...(grupos.get(a.piso) ?? []), a])
  return [...grupos.entries()].sort(([a], [b]) => a - b)
}

const ordenarAulas = (aulas: AulaCatalogo[]) =>
  [...aulas].sort((a, b) => a.piso - b.piso || a.aula.localeCompare(b.aula, 'es', { numeric: true }))

function EstadoAula({ activa }: { activa: boolean }) {
  const token = activa ? '--estado-resuelta' : '--estado-cerrada'
  return (
    <span className="ui-badge" style={{ '--badge-bg': `var(${token}-bg)`, '--badge-text': `var(${token}-text)` } as CSSProperties}>
      {activa ? 'Activa' : 'Inactiva'}
    </span>
  )
}

function CopiarQR({ aula }: { aula: AulaCatalogo }) {
  const [copiado, setCopiado] = useState(false)
  async function copiar() {
    try {
      await navigator.clipboard.writeText(aula.id_publico)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    } catch {
      setCopiado(false)
    }
  }
  return (
    <Button variante="fantasma" tamano="sm" aria-label={copiado ? `QR de ${aula.aula} copiado` : `Copiar QR de ${aula.aula}`}
      icono={copiado ? <Check size={16} className="text-ok" /> : <Copy size={16} />} onClick={() => void copiar()} />
  )
}

function SeccionEdificio({ edificio, total, filtrado, onEditar, onCambiarEstado }: Acciones & {
  edificio: EdificioCatalogo; total: EdificioCatalogo | undefined; filtrado: boolean
}) {
  const [abierto, setAbierto] = useState<boolean | null>(null)
  const expandido = abierto ?? filtrado
  const base = total ?? edificio
  const inactivas = base.total_aulas - base.activas
  const resumen = `${plural(base.total_aulas, 'aula', 'aulas')} · ${plural(base.activas, 'activa', 'activas')}`
    + (inactivas > 0 ? ` · ${plural(inactivas, 'inactiva', 'inactivas')}` : '')
    + ` · ${plural(base.pisos.length, 'piso', 'pisos')}`
  const descripcion = filtrado ? `${edificio.aulas.length} de ${plural(base.total_aulas, 'aula coincide', 'aulas coinciden')}` : resumen
  return (
    <Seccion titulo={edificio.edificio} descripcion={descripcion} sinPadding={expandido && edificio.aulas.length > 0}
      acciones={edificio.aulas.length > 0 && (
        <Button variante="fantasma" tamano="sm" aria-expanded={expandido} onClick={() => setAbierto(!expandido)}
          icono={<ChevronDown size={16} className={expandido ? 'rotate-180 transition-transform' : 'transition-transform'} />}>
          {expandido ? 'Ocultar' : 'Ver aulas'}
        </Button>
      )}>
      {edificio.aulas.length === 0 ? (
        <p className="m-0 text-sm text-muted">Sin aulas registradas en este edificio.</p>
      ) : expandido ? (
        <Tabla etiqueta={`Aulas de ${edificio.edificio}`} apilada densa>
          <thead>
            <tr><th scope="col">Aula</th><th scope="col">Piso</th><th scope="col">Estado</th><th scope="col">ID del QR</th><th scope="col">Acciones</th></tr>
          </thead>
          <tbody>
            {ordenarAulas(edificio.aulas).map((a) => (
              <tr key={a.id_publico}>
                <td data-label="Aula" className="font-semibold text-ink">{a.aula}</td>
                <td data-label="Piso">{nombrePiso(a.piso)}</td>
                <td data-label="Estado"><EstadoAula activa={a.activa} /></td>
                <td data-label="ID del QR">
                  <span className="inline-flex items-center gap-1">
                    <code className="break-all text-sm text-muted">{a.id_publico}</code>
                    <CopiarQR aula={a} />
                  </span>
                </td>
                <td data-label="Acciones">
                  <span className="inline-flex flex-wrap gap-1">
                    <Button variante="fantasma" tamano="sm" icono={<Pencil size={16} />} aria-label={`Editar ${a.aula}`}
                      onClick={() => onEditar({ ...a, edificio: edificio.edificio })}>Editar</Button>
                    <Button variante="fantasma" tamano="sm" icono={<Power size={16} />} aria-label={`${a.activa ? 'Desactivar' : 'Activar'} ${a.aula}`}
                      onClick={() => onCambiarEstado({ ...a, edificio: edificio.edificio })}>{a.activa ? 'Desactivar' : 'Activar'}</Button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      ) : (
        <ul aria-label={`Pisos de ${edificio.edificio}`} className="m-0 flex list-none flex-wrap gap-2 p-0">
          {porPiso(edificio.aulas).map(([piso, aulas]) => (
            <li key={piso} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel-2 px-3 py-1 text-sm text-ink">
              <span className="font-semibold">{nombrePiso(piso)}</span>
              <span className="text-muted">· {plural(aulas.length, 'aula', 'aulas')}</span>
            </li>
          ))}
        </ul>
      )}
    </Seccion>
  )
}

/** Solo los campos que cambiaron respecto al aula original (PATCH parcial). */
function cambiosDe(original: AulaFila, datos: AulaIn): AulaPatch {
  return Object.fromEntries(CAMPOS_AULA.filter((c) => datos[c] !== original[c]).map((c) => [c, datos[c]])) as AulaPatch
}

function FormAula({ formulario, edificios, onCerrar, onGuardado }: {
  formulario: Formulario
  edificios: string[]
  onCerrar: () => void
  onGuardado: (mensaje: string) => void
}) {
  const crear = useCrearAula()
  const editar = useEditarAula()
  const idLista = useId()
  const [error, setErrorGeneral] = useState<string | null>(null)
  const original = formulario.modo === 'editar' ? formulario.aula : null
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<AulaIn>({
    resolver: zodResolver(aulaInSchema),
    mode: 'onTouched',
    defaultValues: original
      ? { edificio: original.edificio, piso: original.piso, aula: original.aula, activa: original.activa }
      : VACIO,
  })

  async function guardar(datos: AulaIn) {
    setErrorGeneral(null)
    try {
      if (original) {
        const cambios = cambiosDe(original, datos)
        if (!Object.keys(cambios).length) { setErrorGeneral('No hay cambios que guardar'); return }
        const r = await editar.mutateAsync({ id: original.id_publico, datos: cambios })
        onGuardado(`Aula ${r.aula} actualizada`)
      } else {
        const r = await crear.mutateAsync(datos)
        onGuardado(`Aula ${r.aula} creada en ${r.edificio}. Su ID del QR es ${r.id_publico}`)
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 400 && Object.keys(e.campos).length) {
        const sueltos: string[] = []
        let primero = true
        for (const [ruta, mensaje] of Object.entries(e.campos)) {
          const campo = ruta.split('.')[0] as (typeof CAMPOS_AULA)[number]
          if (CAMPOS_AULA.includes(campo)) {
            setError(campo, { type: 'servidor', message: mensaje }, { shouldFocus: primero })
            primero = false
          } else sueltos.push(mensaje)
        }
        if (sueltos.length) setErrorGeneral(sueltos.join('. '))
        return
      }
      setErrorGeneral(mensajeDeError(e, 'No se pudo guardar el aula'))
    }
  }

  return (
    <form noValidate aria-label={original ? 'Editar aula' : 'Nueva aula'} className="flex flex-col gap-4"
      onSubmit={(e) => { void handleSubmit(guardar)(e) }}>
      <Input etiqueta="Edificio" required autoComplete="off" maxLength={60} list={idLista} placeholder="Ej. Edificio A"
        ayuda="Elige uno existente o escribe uno nuevo." error={errors.edificio?.message} {...register('edificio')} />
      <datalist id={idLista}>{edificios.map((e) => <option key={e} value={e} />)}</datalist>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input etiqueta="Piso" required type="number" inputMode="numeric" min={-5} max={50} step={1}
          ayuda="0 = planta baja; negativos para sótanos." error={errors.piso?.message} {...register('piso', { valueAsNumber: true })} />
        <Input etiqueta="Aula" required autoComplete="off" maxLength={60} placeholder="Ej. A-201"
          error={errors.aula?.message} {...register('aula')} />
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
        <input type="checkbox" className="h-5 w-5" {...register('activa')} />
        Activa (se puede elegir al reportar y su QR funciona)
      </label>
      {original && <p className="m-0 text-sm text-muted">El ID del QR (<code className="break-all">{original.id_publico}</code>) no cambia al editar.</p>}
      {error && <p role="alert" className="ui-campo__error m-0">{error}</p>}
      <div className="ui-sheet__acciones mt-0!">
        <Button variante="secundario" onClick={onCerrar} disabled={isSubmitting}>Cancelar</Button>
        <Button type="submit" cargando={isSubmitting} textoCargando="Guardando…">{original ? 'Guardar cambios' : 'Crear aula'}</Button>
      </div>
    </form>
  )
}

export default function AdminEdificios() {
  const catalogo = useQuery(catalogoAulasQuery())
  const [busqueda, setBusqueda] = useState('')
  const [estado, setEstado] = useState<FiltroEstado>('todas')
  const datos = useMemo(() => catalogo.data ?? [], [catalogo.data])
  const visibles = useMemo(() => filtrar(datos, busqueda, estado), [datos, busqueda, estado])
  const filtrado = normalizar(busqueda) !== '' || estado !== 'todas'
  const totales = useMemo(() => {
    const aulas = datos.reduce((s, e) => s + e.total_aulas, 0)
    const activas = datos.reduce((s, e) => s + e.activas, 0)
    return { edificios: datos.length, aulas, activas, inactivas: aulas - activas }
  }, [datos])
  const limpiar = () => { setBusqueda(''); setEstado('todas') }
  const editar = useEditarAula()
  const [formulario, setFormulario] = useState<Formulario | null>(null)
  const [confirmar, setConfirmar] = useState<AulaFila | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [errorEstado, setErrorEstado] = useState<string | null>(null)
  const abrir = (f: Formulario) => { setAviso(null); setErrorEstado(null); setFormulario(f) }

  async function fijarEstado(aula: AulaFila, activa: boolean) {
    setAviso(null)
    setErrorEstado(null)
    try {
      await editar.mutateAsync({ id: aula.id_publico, datos: { activa } })
      setAviso(activa ? `Aula ${aula.aula} activada` : `Aula ${aula.aula} desactivada`)
    } catch (e) {
      setErrorEstado(mensajeDeError(e, 'No se pudo cambiar el estado del aula'))
    } finally {
      setConfirmar(null)
    }
  }
  // Desactivar pide confirmación (el QR deja de funcionar); activar es inmediato.
  const cambiarEstado = (a: AulaFila) => (a.activa ? setConfirmar(a) : void fijarEstado(a, true))

  return (
    <div className="pila">
      <PageHeader titulo="Edificios y aulas" subtitulo="Aulas del campus, su estado y el ID de su código QR."
        acciones={<Button icono={<Plus size={18} />} onClick={() => abrir({ modo: 'crear' })}>Nueva aula</Button>} />
      {aviso && <Aviso tipo="ok" onCerrar={() => setAviso(null)}>{aviso}</Aviso>}
      {errorEstado && <Aviso tipo="error" onCerrar={() => setErrorEstado(null)}>{errorEstado}</Aviso>}
      {catalogo.isPending ? (
        <SkeletonLista etiqueta="Cargando edificios" />
      ) : catalogo.isError ? (
        <ErrorState mensaje={mensajeDeError(catalogo.error, 'No se pudo cargar el catálogo de aulas')}
          onReintentar={() => void catalogo.refetch()} reintentando={catalogo.isFetching} />
      ) : datos.length === 0 ? (
        <EmptyState titulo="Aún no hay aulas registradas" icono={QrCode}
          descripcion="Aún no hay aulas registradas. Usa «Nueva aula» para darlas de alta; cada una recibe su código QR."
          accion={<Button variante="secundario" tamano="sm" icono={<Plus size={16} />} onClick={() => abrir({ modo: 'crear' })}>Nueva aula</Button>} />
      ) : (
        <>
          <StatGrid columnas={4} etiqueta="Resumen del catálogo">
            <StatTile etiqueta="Edificios" valor={totales.edificios} icono={<Building2 size={18} />} />
            <StatTile etiqueta="Aulas" valor={totales.aulas} icono={<DoorOpen size={18} />} tono="brand" />
            <StatTile etiqueta="Activas" valor={totales.activas} icono={<CircleCheck size={18} />} tono="success" />
            <StatTile etiqueta="Inactivas" valor={totales.inactivas} icono={<CircleOff size={18} />} />
          </StatGrid>
          <BarraFiltros etiqueta="Filtrar aulas" activos={(busqueda.trim() ? 1 : 0) + (estado !== 'todas' ? 1 : 0)}
            acciones={filtrado && <Button variante="fantasma" tamano="sm" onClick={limpiar}>Limpiar</Button>}>
            <Input etiqueta="Buscar edificio o aula" etiquetaOculta tamano="sm" type="search" icono={<Search size={16} />}
              value={busqueda} placeholder="Buscar edificio o aula (ej. A-201)" onChange={(e) => setBusqueda(e.target.value)} />
            <Segmentado etiqueta="Estado" tamano="sm" valor={estado} onCambio={setEstado}
              opciones={[{ valor: 'todas', texto: 'Todas' }, { valor: 'activas', texto: 'Activas' }, { valor: 'inactivas', texto: 'Inactivas' }]} />
          </BarraFiltros>
          <p role="status" className="m-0 text-sm text-muted">
            {plural(visibles.length, 'edificio', 'edificios')}
            {filtrado && ` · ${plural(visibles.reduce((s, e) => s + e.aulas.length, 0), 'aula', 'aulas')}`}
          </p>
          {visibles.length === 0 ? (
            <EmptyState compacto titulo="Sin resultados" icono={SearchX}
              descripcion={busqueda.trim() ? `Ningún edificio ni aula coincide con “${busqueda.trim()}”.` : 'Ninguna aula con ese estado.'}
              accion={<Button variante="secundario" tamano="sm" onClick={limpiar}>Limpiar filtros</Button>} />
          ) : (
            visibles.map((e) => (
              <SeccionEdificio key={e.edificio} edificio={e} filtrado={filtrado} total={datos.find((d) => d.edificio === e.edificio)}
                onEditar={(aula) => abrir({ modo: 'editar', aula })} onCambiarEstado={cambiarEstado} />
            ))
          )}
        </>
      )}

      <BottomSheet abierto={formulario !== null} onCerrar={() => setFormulario(null)}
        titulo={formulario?.modo === 'editar' ? 'Editar aula' : 'Nueva aula'}>
        {formulario && (
          <FormAula key={formulario.modo === 'editar' ? formulario.aula.id_publico : 'nueva'} formulario={formulario}
            edificios={datos.map((e) => e.edificio)} onCerrar={() => setFormulario(null)}
            onGuardado={(mensaje) => { setFormulario(null); setAviso(mensaje) }} />
        )}
      </BottomSheet>

      <BottomSheet abierto={confirmar !== null} onCerrar={() => { if (!editar.isPending) setConfirmar(null) }} titulo="¿Desactivar aula?"
        acciones={<>
          <Button variante="secundario" disabled={editar.isPending} onClick={() => setConfirmar(null)}>Cancelar</Button>
          <Button variante="peligro" cargando={editar.isPending} textoCargando="Desactivando…"
            onClick={() => { if (confirmar) void fijarEstado(confirmar, false) }}>Confirmar desactivación</Button>
        </>}>
        {confirmar && <p className="m-0 text-sm text-muted">
          {confirmar.aula} ({confirmar.edificio}) dejará de aparecer al reportar y su código QR ya no abrirá el formulario. Puedes volver a activarla cuando quieras.
        </p>}
      </BottomSheet>
    </div>
  )
}
