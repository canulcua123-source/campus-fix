import { Lock, Pencil, Plus, Shield, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { ApiError, mensajeDeError } from '../api/client'
import { useCrearRol, useEditarRol, useEliminarRol, useRoles } from '../api/hooks/admin'
import { puedeOtorgar } from '../api/usuarios'
import { SiPermiso } from '../auth/RequirePermiso'
import { useAuth } from '../auth/store'
import { BottomSheet, Button, Card, EmptyState, ErrorState, Input, PageHeader, Select, SkeletonLista, Textarea } from '../components/ui'
import { ETIQUETAS_ALCANCE, ETIQUETAS_PERMISO } from '../schemas/etiquetas'
import { ALCANCES, PERMISOS, rolInSchema, rolPatchSchema, type AlcanceRol, type Rol, type RolIn, type RolPatch } from '../schemas/usuario'

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

/** Administración de roles (GET/POST/PATCH/DELETE /roles). Los roles del sistema son de solo lectura. */
export default function AdminRoles() {
  const actor = useAuth((s) => s.usuario)
  const roles = useRoles()
  const crear = useCrearRol()
  const editar = useEditarRol()
  const eliminar = useEliminarRol()
  const [modo, setModo] = useState<Modo>(null)
  const [form, setForm] = useState<Formulario>(VACIO)
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
    setForm(siguiente?.tipo === 'editar'
      ? { clave: siguiente.rol.clave, nombre: siguiente.rol.nombre, descripcion: siguiente.rol.descripcion ?? '', permisos: [...siguiente.rol.permisos], alcance: siguiente.rol.alcance }
      : VACIO)
  }
  const actualizar = <K extends keyof Formulario,>(campo: K, valor: Formulario[K]) => {
    setForm((f) => ({ ...f, [campo]: valor }))
    setErrores(({ [campo]: _quitado, _general: _g, ...resto }) => resto)
  }

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
    <div className="flex flex-col gap-5">
      <PageHeader
        titulo="Roles y permisos"
        subtitulo="Define qué puede hacer cada tipo de cuenta"
        acciones={<SiPermiso permiso={PERMISO}><Button icono={<Plus size={18} aria-hidden />} onClick={() => abrir({ tipo: 'crear' })}>Nuevo rol</Button></SiPermiso>}
      />
      {aviso && <p role="status" className="rounded-lg border border-line bg-panel p-3 text-ok">{aviso}</p>}

      {modo && (
        <Card como="section" aria-label={modo.tipo === 'crear' ? 'Nuevo rol' : 'Editar rol'} className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold text-ink">{modo.tipo === 'crear' ? 'Nuevo rol' : `Editar: ${modo.rol.nombre}`}</h2>
          <form noValidate onSubmit={(e) => { void guardar(e) }} className="flex flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Input etiqueta="Clave" required value={form.clave} maxLength={30} error={errores.clave} autoComplete="off"
                ayuda="Minúsculas y guion bajo, de 3 a 30 caracteres." onChange={(e) => actualizar('clave', e.target.value)} />
              <Input etiqueta="Nombre" required value={form.nombre} maxLength={50} error={errores.nombre}
                onChange={(e) => actualizar('nombre', e.target.value)} />
              <Select etiqueta="Alcance" required value={form.alcance} error={errores.alcance}
                opciones={alcances.map((a) => ({ valor: a, texto: ETIQUETAS_ALCANCE[a] }))}
                onChange={(e) => actualizar('alcance', e.target.value as AlcanceRol)} />
              <Textarea etiqueta="Descripción (opcional)" rows={2} value={form.descripcion} maxLength={200} error={errores.descripcion}
                onChange={(e) => actualizar('descripcion', e.target.value)} />
            </div>
            <fieldset className="rounded-lg border border-line p-4">
              <legend className="px-2 font-semibold">Permisos</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {PERMISOS.map((p) => {
                  const propio = actor.permisos.includes(p)
                  return (
                    <label key={p} className="flex min-h-11 items-center gap-2 text-sm">
                      <input type="checkbox" className="h-5 w-5" checked={form.permisos.includes(p)} disabled={!propio}
                        onChange={(e) => actualizar('permisos', e.target.checked ? [...form.permisos, p] : form.permisos.filter((x) => x !== p))} />
                      {ETIQUETAS_PERMISO[p]}
                      {!propio && <span className="text-muted">(no lo tienes)</span>}
                    </label>
                  )
                })}
              </div>
              {errores.permisos && <p role="alert" className="text-sm text-bad">{errores.permisos}</p>}
            </fieldset>
            {errores._general && <p role="alert" className="text-sm text-bad">{errores._general}</p>}
            <div className="flex flex-wrap justify-end gap-3">
              <Button variante="secundario" onClick={() => setModo(null)} disabled={guardando}>Cancelar</Button>
              <Button type="submit" cargando={guardando} textoCargando="Guardando…">{modo.tipo === 'crear' ? 'Crear rol' : 'Guardar cambios'}</Button>
            </div>
          </form>
        </Card>
      )}

      {roles.isPending ? <SkeletonLista etiqueta="Cargando roles" /> :
        roles.isError ? <ErrorState mensaje={mensajeDeError(roles.error, 'No se pudieron cargar los roles')} onReintentar={() => { void roles.refetch() }} reintentando={roles.isFetching} /> :
          roles.data.length === 0 ? <EmptyState icono={Shield} titulo="Aún no hay roles" descripcion="Crea el primer rol para asignarlo a usuarios." /> :
            <ul className="grid gap-3 md:grid-cols-2" aria-label="Roles">
              {roles.data.map((rol) => (
                <Card como="li" key={rol._id} className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="text-lg font-semibold text-ink">{rol.nombre}</h2>
                      <p className="text-sm text-muted">{rol.clave} · {ETIQUETAS_ALCANCE[rol.alcance]}</p>
                    </div>
                    {rol.sistema && <span className="inline-flex items-center gap-1 text-sm text-muted"><Lock size={14} aria-hidden /> Rol del sistema</span>}
                  </div>
                  {rol.descripcion && <p className="text-sm">{rol.descripcion}</p>}
                  <ul className="flex flex-wrap gap-2 text-sm" aria-label={`Permisos de ${rol.nombre}`}>
                    {rol.permisos.map((p) => (
                      <li key={p} className="rounded-full border border-line px-2 py-1">{ETIQUETAS_PERMISO[p as keyof typeof ETIQUETAS_PERMISO] ?? p}</li>
                    ))}
                  </ul>
                  <SiPermiso permiso={PERMISO}>
                    {administrable(rol) ? (
                      <div className="flex flex-wrap gap-2">
                        <Button variante="secundario" icono={<Pencil size={16} aria-hidden />} onClick={() => abrir({ tipo: 'editar', rol })}>
                          Editar
                        </Button>
                        <Button variante="peligro" icono={<Trash2 size={16} aria-hidden />} onClick={() => { setErrorEliminar(null); setPorEliminar(rol) }}>
                          Eliminar
                        </Button>
                      </div>
                    ) : (
                      <p className="text-sm text-muted">
                        {rol.sistema ? 'Los roles del sistema no se pueden modificar.' : 'Este rol tiene más permisos o alcance que el tuyo.'}
                      </p>
                    )}
                  </SiPermiso>
                </Card>
              ))}
            </ul>}

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
        <p>Se eliminará «{porEliminar?.nombre}». Solo es posible si ningún usuario lo tiene asignado.</p>
        {errorEliminar && <p role="alert" className="mt-3 text-sm text-bad">{errorEliminar}</p>}
      </BottomSheet>
    </div>
  )
}
