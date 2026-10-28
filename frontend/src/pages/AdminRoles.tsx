import { Lock, Pencil, Plus, Shield, ShieldCheck, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { ApiError, mensajeDeError } from '../api/client'
import { useCrearRol, useEditarRol, useEliminarRol, useRoles } from '../api/hooks/admin'
import { puedeOtorgar } from '../api/usuarios'
import { SiPermiso } from '../auth/RequirePermiso'
import { useAuth } from '../auth/store'
import { Aviso, Chip, Paso } from '../components/admin/PiezasAdmin'
import { DESCRIPCION_ALCANCE, DESCRIPCION_PERMISO, GRUPOS_PERMISOS, etiquetaPermiso, permisosAgrupados } from '../components/admin/permisos'
import { BottomSheet, Button, Card, EmptyState, ErrorState, Input, PageHeader, SkeletonLista, Textarea } from '../components/ui'
import { ETIQUETAS_ALCANCE } from '../schemas/etiquetas'
import { ALCANCES, rolInSchema, rolPatchSchema, type AlcanceRol, type Rol, type RolIn, type RolPatch } from '../schemas/usuario'

type Modo = { tipo: 'crear' } | { tipo: 'editar'; rol: Rol } | null
type Formulario = { clave: string; nombre: string; descripcion: string; permisos: string[]; alcance: AlcanceRol }

const VACIO: Formulario = { clave: '', nombre: '', descripcion: '', permisos: [], alcance: 'propio' }
const PERMISO = 'roles:gestionar'

function erroresDe(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const errores: Record<string, string> = {}
  for (const i of issues) {
    const campo = String(i.path[0] ?? '_general')
    if (!errores[campo]) errores[campo] = i.message
  }
  return errores
}

/** Solo los campos que cambiaron (PATCH parcial, sin null). */
function cambiosDe(form: Formulario, rol: Rol): Record<string, unknown> {
  const cambios: Record<string, unknown> = {}
  if (form.clave !== rol.clave) cambios.clave = form.clave
  if (form.nombre.trim() !== rol.nombre) cambios.nombre = form.nombre.trim()
  if (form.descripcion.trim() !== (rol.descripcion ?? '')) cambios.descripcion = form.descripcion.trim()
  if ([...form.permisos].sort().join() !== [...rol.permisos].sort().join()) cambios.permisos = form.permisos
  if (form.alcance !== rol.alcance) cambios.alcance = form.alcance
  return cambios
}

/** Sugerencia de clave a partir del nombre ("Jefe de área" → "jefe_de_area"). */
function claveDe(nombre: string): string {
  return nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30)
}

/** Resumen de cambios antes de guardar (lo que se agrega y quita). */
function ResumenCambios({ form, rol }: { form: Formulario; rol: Rol | null }) {
  if (!rol) {
    return <p className="text-sm text-muted" aria-live="polite">Se creará con {form.permisos.length} permiso(s) y alcance «{ETIQUETAS_ALCANCE[form.alcance]}».</p>
  }
  const agregados = form.permisos.filter((p) => !rol.permisos.includes(p))
  const quitados = rol.permisos.filter((p) => !form.permisos.includes(p))
  const otros: string[] = []
  if (form.nombre.trim() !== rol.nombre) otros.push('nombre')
  if (form.clave !== rol.clave) otros.push('clave')
  if (form.descripcion.trim() !== (rol.descripcion ?? '')) otros.push('descripción')
  if (form.alcance !== rol.alcance) otros.push(`alcance: ${ETIQUETAS_ALCANCE[rol.alcance]} → ${ETIQUETAS_ALCANCE[form.alcance]}`)
  if (!agregados.length && !quitados.length && !otros.length) return <p className="text-sm text-muted" aria-live="polite">Aún no hay cambios.</p>
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-line bg-panel-2 p-3 text-sm" aria-live="polite">
      <p className="font-semibold text-ink">Resumen de cambios</p>
      {agregados.length > 0 && <p><span className="font-semibold text-ok">+ Agrega:</span> {agregados.map(etiquetaPermiso).join(', ')}</p>}
      {quitados.length > 0 && <p><span className="font-semibold text-bad">− Quita:</span> {quitados.map(etiquetaPermiso).join(', ')}</p>}
      {otros.length > 0 && <p><span className="font-semibold">Edita:</span> {otros.join(', ')}</p>}
    </div>
  )
}

/** Administración de roles (GET/POST/PATCH/DELETE /roles). Los roles del sistema son de solo lectura. */
export default function AdminRoles() {
  const actor = useAuth((s) => s.usuario)
  const roles = useRoles()
  const crear = useCrearRol()
  const editar = useEditarRol()
  const eliminar = useEliminarRol()
  const [modo, setModo] = useState<Modo>(null)
  const [form, setForm] = useState<Formulario>(VACIO)
  const [claveManual, setClaveManual] = useState(false)
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [aviso, setAviso] = useState<string | null>(null)
  const [porEliminar, setPorEliminar] = useState<Rol | null>(null)
  const [errorEliminar, setErrorEliminar] = useState<string | null>(null)
  const guardando = crear.isPending || editar.isPending

  if (!actor) return null
  const otorgable = (permisos: readonly string[], alcance: AlcanceRol) => puedeOtorgar(actor, permisos, alcance)
  const administrable = (rol: Rol) => rol.sistema !== true && otorgable(rol.permisos, rol.alcance)
  const alcances = ALCANCES.filter((a) => otorgable([], a))

  const abrir = (siguiente: Modo) => {
    setModo(siguiente)
    setErrores({})
    setAviso(null)
    setClaveManual(siguiente?.tipo === 'editar')
    setForm(siguiente?.tipo === 'editar'
      ? { clave: siguiente.rol.clave, nombre: siguiente.rol.nombre, descripcion: siguiente.rol.descripcion ?? '', permisos: [...siguiente.rol.permisos], alcance: siguiente.rol.alcance }
      : VACIO)
  }
  const cerrar = () => { if (!guardando) setModo(null) }
  const actualizar = <K extends keyof Formulario,>(campo: K, valor: Formulario[K]) => {
    setForm((f) => ({ ...f, [campo]: valor }))
    setErrores(({ [campo]: _quitado, _general: _g, ...resto }) => resto)
  }
  const alternarPermisos = (lista: string[], marcar: boolean) =>
    actualizar('permisos', marcar ? [...new Set([...form.permisos, ...lista])] : form.permisos.filter((p) => !lista.includes(p)))

  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!modo || guardando) return
    const entrada = modo.tipo === 'crear' ? { ...form, nombre: form.nombre.trim(), descripcion: form.descripcion.trim() } : cambiosDe(form, modo.rol)
    if (modo.tipo === 'editar' && Object.keys(entrada).length === 0) {
      setErrores({ _general: 'No hay cambios por guardar' })
      return
    }
    const validado = (modo.tipo === 'crear' ? rolInSchema : rolPatchSchema).safeParse(entrada)
    if (!validado.success) {
      setErrores(erroresDe(validado.error.issues))
      return
    }
    if (!otorgable(form.permisos, form.alcance)) {
      setErrores({ _general: 'No puedes otorgar permisos o un alcance mayores a los tuyos' })
      return
    }
    try {
      if (modo.tipo === 'crear') await crear.mutateAsync(validado.data as RolIn)
      else await editar.mutateAsync({ id: modo.rol._id, datos: validado.data as RolPatch })
      setModo(null)
      setAviso(modo.tipo === 'crear' ? 'Rol creado correctamente' : 'Cambios guardados correctamente')
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.campos).length) setErrores(err.campos)
      else setErrores({ _general: mensajeDeError(err, 'No se pudo guardar el rol') })
    }
  }

  async function confirmarEliminar() {
    if (!porEliminar || eliminar.isPending) return
    try {
      await eliminar.mutateAsync(porEliminar._id)
      setAviso(`Rol «${porEliminar.nombre}» eliminado`)
      setPorEliminar(null)
      if (modo?.tipo === 'editar' && modo.rol._id === porEliminar._id) setModo(null)
    } catch (err) {
      setErrorEliminar(mensajeDeError(err, 'No se pudo eliminar el rol'))
    }
  }

  return (
    <div className="pila">
      <PageHeader
        titulo="Roles y permisos"
        subtitulo="Define qué puede hacer cada tipo de cuenta y qué reportes ve"
        acciones={<SiPermiso permiso={PERMISO}><Button icono={<Plus size={18} aria-hidden />} onClick={() => abrir({ tipo: 'crear' })}>Nuevo rol</Button></SiPermiso>}
      />
      {aviso && <Aviso tipo="ok" onCerrar={() => setAviso(null)}>{aviso}</Aviso>}

      {roles.isPending ? <SkeletonLista etiqueta="Cargando roles" /> :
        roles.isError ? <ErrorState mensaje={mensajeDeError(roles.error, 'No se pudieron cargar los roles')} onReintentar={() => { void roles.refetch() }} reintentando={roles.isFetching} /> :
          roles.data.length === 0 ? <EmptyState icono={Shield} titulo="Aún no hay roles" descripcion="Crea el primer rol para asignarlo a usuarios."
            accion={<SiPermiso permiso={PERMISO}><Button icono={<Plus size={18} aria-hidden />} onClick={() => abrir({ tipo: 'crear' })}>Nuevo rol</Button></SiPermiso>} /> :
            <ul className="grid gap-3 md:grid-cols-2" aria-label="Roles">
              {roles.data.map((rol) => (
                <Card como="li" key={rol._id} className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="text-lg font-semibold text-ink">{rol.nombre}</h2>
                      <p className="break-all font-mono text-xs text-muted">{rol.clave}</p>
                    </div>
                    <span className="flex flex-wrap gap-1">
                      {rol.clave === 'superadmin' && <Chip tono="neutro" icono={<ShieldCheck size={12} aria-hidden />}>Superadmin</Chip>}
                      {rol.sistema && <Chip tono="apagado" icono={<Lock size={12} aria-hidden />}>Rol del sistema</Chip>}
                    </span>
                  </div>
                  {rol.descripcion && <p className="text-sm text-muted">{rol.descripcion}</p>}
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Chip tono="marca">{ETIQUETAS_ALCANCE[rol.alcance]}</Chip>
                    <span className="text-muted">{rol.permisos.length} {rol.permisos.length === 1 ? 'permiso' : 'permisos'}</span>
                  </div>
                  {rol.permisos.length > 0 && (
                    <dl className="grid gap-1 text-sm" aria-label={`Permisos de ${rol.nombre}`}>
                      {permisosAgrupados(rol.permisos).map((g) => (
                        <div key={g.titulo} className="grid gap-x-2 sm:grid-cols-[120px_1fr]">
                          <dt className="text-muted">{g.titulo}</dt>
                          <dd className="text-ink">{g.permisos.map(etiquetaPermiso).join(', ')}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <SiPermiso permiso={PERMISO}>
                    <div className="mt-auto border-t border-line pt-3">
                      {administrable(rol) ? (
                        <div className="flex flex-wrap gap-2">
                          <Button variante="secundario" tamano="sm" icono={<Pencil size={16} aria-hidden />} onClick={() => abrir({ tipo: 'editar', rol })}>
                            Editar
                          </Button>
                          <Button variante="fantasma" tamano="sm" icono={<Trash2 size={16} aria-hidden />} onClick={() => { setErrorEliminar(null); setPorEliminar(rol) }}>
                            Eliminar
                          </Button>
                        </div>
                      ) : (
                        <p className="text-sm text-muted">
                          {rol.sistema ? 'Los roles del sistema no se pueden modificar.' : 'Este rol tiene más permisos o alcance que el tuyo.'}
                        </p>
                      )}
                    </div>
                  </SiPermiso>
                </Card>
              ))}
            </ul>}

      <BottomSheet abierto={modo !== null} onCerrar={cerrar} titulo={modo?.tipo === 'editar' ? 'Editar rol' : 'Nuevo rol'}>
        {modo && (
          <form noValidate aria-label={modo.tipo === 'crear' ? 'Nuevo rol' : 'Editar rol'} onSubmit={(e) => { void guardar(e) }} className="flex flex-col gap-5">
            <Paso numero={1} titulo="Identidad" ayuda="Cómo verán este rol quienes administran cuentas.">
              <Input etiqueta="Nombre" required value={form.nombre} maxLength={50} error={errores.nombre} placeholder="Ej. Jefe de mantenimiento"
                onChange={(e) => {
                  const nombre = e.target.value
                  actualizar('nombre', nombre)
                  if (!claveManual) actualizar('clave', claveDe(nombre))
                }} />
              <Input etiqueta="Clave" required value={form.clave} maxLength={30} error={errores.clave} autoComplete="off"
                ayuda="Identificador interno: minúsculas y guion bajo, de 3 a 30 caracteres."
                onChange={(e) => { setClaveManual(true); actualizar('clave', e.target.value) }} />
              <Textarea etiqueta="Descripción (opcional)" rows={2} value={form.descripcion} maxLength={200} error={errores.descripcion}
                placeholder="Para qué sirve este rol" onChange={(e) => actualizar('descripcion', e.target.value)} />
            </Paso>

            <Paso numero={2} titulo="Alcance" ayuda="Qué reportes podrá ver quien tenga este rol.">
              <div role="radiogroup" aria-label="Alcance" className="grid gap-2 sm:grid-cols-2">
                {alcances.map((a) => (
                  <label key={a} className={`flex min-h-11 cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm ${form.alcance === a ? 'border-brand bg-panel-2' : 'border-line'}`}>
                    <input type="radio" name="alcance" value={a} className="mt-0.5 h-5 w-5 shrink-0" checked={form.alcance === a}
                      onChange={() => actualizar('alcance', a)} />
                    <span><span className="block font-semibold text-ink">{ETIQUETAS_ALCANCE[a]}</span><span className="block text-muted">{DESCRIPCION_ALCANCE[a]}</span></span>
                  </label>
                ))}
              </div>
              {errores.alcance && <p role="alert" className="ui-campo__error">{errores.alcance}</p>}
            </Paso>

            <Paso numero={3} titulo="Permisos" ayuda="Solo puedes otorgar permisos que tú tienes.">
              {GRUPOS_PERMISOS.map((g) => {
                const disponibles = g.permisos.filter((p) => actor.permisos.includes(p))
                const marcados = g.permisos.filter((p) => form.permisos.includes(p)).length
                const todos = disponibles.length > 0 && disponibles.every((p) => form.permisos.includes(p))
                return (
                  <div key={g.clave} className="rounded-xl border border-line">
                    <div className="flex items-center justify-between gap-2 border-b border-line bg-panel-2 px-3">
                      <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-2 text-sm font-semibold text-ink">
                        <input type="checkbox" className="h-5 w-5" checked={todos} disabled={!disponibles.length}
                          aria-label={`Seleccionar todo: ${g.titulo}`}
                          ref={(el) => { if (el) el.indeterminate = marcados > 0 && !todos }}
                          onChange={(e) => alternarPermisos(disponibles, e.target.checked)} />
                        <span aria-hidden>{g.titulo}</span>
                      </label>
                      <span className="text-xs text-muted">{marcados} de {g.permisos.length}</span>
                    </div>
                    <ul className="flex flex-col">
                      {g.permisos.map((p) => {
                        const propio = actor.permisos.includes(p)
                        const id = `permiso-${p.replace(':', '-')}`
                        return (
                          <li key={p} className="flex items-start gap-3 border-b border-line px-3 py-2 last:border-b-0">
                            <input id={id} type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={form.permisos.includes(p)} disabled={!propio}
                              aria-describedby={`${id}-desc`}
                              onChange={(e) => alternarPermisos([p], e.target.checked)} />
                            <div className="min-w-0 text-sm">
                              <label htmlFor={id} className={propio ? 'cursor-pointer font-medium text-ink' : 'font-medium text-muted'}>{etiquetaPermiso(p)}</label>
                              <p id={`${id}-desc`} className="text-muted">{DESCRIPCION_PERMISO[p]}{!propio && ' · No lo tienes, no puedes otorgarlo.'}</p>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )
              })}
              {errores.permisos && <p role="alert" className="ui-campo__error">{errores.permisos}</p>}
            </Paso>

            <ResumenCambios form={form} rol={modo.tipo === 'editar' ? modo.rol : null} />
            {errores._general && <p role="alert" className="ui-campo__error">{errores._general}</p>}
            <div className="ui-sheet__acciones mt-0!">
              <Button variante="secundario" onClick={cerrar} disabled={guardando}>Cancelar</Button>
              <Button type="submit" cargando={guardando} textoCargando="Guardando…">{modo.tipo === 'crear' ? 'Crear rol' : 'Guardar cambios'}</Button>
            </div>
          </form>
        )}
      </BottomSheet>

      <BottomSheet
        abierto={porEliminar !== null}
        onCerrar={() => { if (!eliminar.isPending) setPorEliminar(null) }}
        titulo="¿Eliminar rol?"
        acciones={<>
          <Button variante="secundario" onClick={() => setPorEliminar(null)} disabled={eliminar.isPending}>Cancelar</Button>
          <Button variante="peligro" cargando={eliminar.isPending} textoCargando="Eliminando…" onClick={() => { void confirmarEliminar() }}>
            Eliminar rol
          </Button>
        </>}
      >
        <p className="text-sm text-muted">Se eliminará «{porEliminar?.nombre}». Solo es posible si ningún usuario lo tiene asignado.</p>
        {errorEliminar && <p role="alert" className="ui-campo__error mt-3">{errorEliminar}</p>}
      </BottomSheet>
    </div>
  )
}
