import { useMemo, useRef, useState, useEffect, type FormEvent } from 'react'
import { Pencil, Plus, Search, UserCheck, UserX } from 'lucide-react'
import { ApiError, mensajeDeError } from '../api/client'
import { useCrearUsuario, useEditarUsuario, useRoles, useUsuarios } from '../api/hooks/admin'
import { errorFortalezaPassword } from '../api/usuarios'
import { useAuth } from '../auth/store'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { ErrorState } from '../components/ui/ErrorState'
import { Input, Select } from '../components/ui/Campo'
import { PageHeader } from '../components/ui/PageHeader'
import { SkeletonLista } from '../components/ui/Skeleton'
import { ETIQUETAS_ALCANCE, ETIQUETAS_CATEGORIA, ETIQUETAS_TIPO_REPORTANTE } from '../schemas/etiquetas'
import { CATEGORIAS } from '../schemas/incidencia'
import { usuarioInSchema, usuarioPatchSchema, type Rol, type UsuarioApi, type UsuarioIn, type UsuarioPatch } from '../schemas/usuario'

type Modo = 'crear' | 'editar' | null
type EstadoFiltro = 'todos' | 'activos' | 'inactivos'
type Formulario = {
    nombre: string
    correo: string
    password: string
    confirmarPassword: string
    rol: string
    areas: string[]
    edificiosTexto: string
    tipo_reportante: string
}

const FORMULARIO_VACIO: Formulario = {
    nombre: '', correo: '', password: '', confirmarPassword: '', rol: '', areas: [], edificiosTexto: '', tipo_reportante: '',
}

function normalizar(texto: string): string {
    return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-MX')
}

function edificiosDe(texto: string): string[] {
    return [...new Set(texto.split(/[\n,]+/).map((edificio) => edificio.trim()).filter(Boolean))]
}

function formDeUsuario(usuario: UsuarioApi): Formulario {
    return {
        nombre: usuario.nombre, correo: usuario.correo, password: '', confirmarPassword: '', rol: usuario.rol,
        areas: usuario.areas ?? [], edificiosTexto: (usuario.edificios ?? []).join('\n'),
        tipo_reportante: usuario.tipo_reportante ?? '',
    }
}

function leerErrores(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
    const errores: Record<string, string> = {}
    for (const issue of issues) {
        const campo = String(issue.path[0] ?? '_general')
        if (!errores[campo]) errores[campo] = issue.message
    }
    return errores
}

function construirEntrada(form: Formulario, rol: Rol, modo: 'crear' | 'editar', original: UsuarioApi | null): { datos: UsuarioIn | UsuarioPatch; errores: Record<string, string> } {
    const errores: Record<string, string> = {}
    const alcance = rol.alcance
    const areas = alcance === 'area' ? form.areas : undefined
    const edificios = alcance === 'edificio' ? edificiosDe(form.edificiosTexto) : undefined
    if (alcance === 'area' && !areas?.length) errores.areas = 'Selecciona al menos un área para este rol'
    if (alcance === 'edificio' && !edificios?.length) errores.edificios = 'Indica al menos un edificio para este rol'

    if (modo === 'crear') {
        const fortaleza = errorFortalezaPassword(form.password)
        if (fortaleza) errores.password = fortaleza
        if (form.password !== form.confirmarPassword) errores.confirmarPassword = 'Las contraseñas no coinciden'
        const entrada = {
            nombre: form.nombre.trim(), correo: form.correo.trim().toLowerCase(), password: form.password,
            rol: form.rol, ...(areas ? { areas } : {}), ...(edificios ? { edificios } : {}),
            ...(form.tipo_reportante ? { tipo_reportante: form.tipo_reportante } : {}),
        }
        const validado = usuarioInSchema.safeParse(entrada)
        if (!validado.success) Object.assign(errores, leerErrores(validado.error.issues))
        return { datos: validado.success ? validado.data : entrada as UsuarioIn, errores }
    }

    if (!original) return { datos: {}, errores: { _general: 'Selecciona un usuario para editar' } }
    const cambios: Record<string, unknown> = {}
    if (form.nombre.trim() !== original.nombre) cambios.nombre = form.nombre.trim()
    const rolCambiado = form.rol !== original.rol
    if (rolCambiado) cambios.rol = form.rol
    if (alcance === 'area' && (rolCambiado || JSON.stringify(areas) !== JSON.stringify(original.areas ?? []))) cambios.areas = areas
    if (alcance === 'edificio' && (rolCambiado || JSON.stringify(edificios) !== JSON.stringify(original.edificios ?? []))) cambios.edificios = edificios
    if (form.tipo_reportante && form.tipo_reportante !== (original.tipo_reportante ?? '')) cambios.tipo_reportante = form.tipo_reportante
    const validado = usuarioPatchSchema.safeParse(cambios)
    if (!validado.success) Object.assign(errores, leerErrores(validado.error.issues))
    if (!Object.keys(cambios).length) errores._general = 'No hay cambios por guardar'
    return { datos: validado.success ? validado.data : cambios as UsuarioPatch, errores }
}

export default function AdminUsuarios() {
    const usuarioActual = useAuth((s) => s.usuario)
    const usuarios = useUsuarios()
    const roles = useRoles()
    const crear = useCrearUsuario()
    const editar = useEditarUsuario()
    const [busqueda, setBusqueda] = useState('')
    const [estadoFiltro, setEstadoFiltro] = useState<EstadoFiltro>('todos')
    const [modo, setModo] = useState<Modo>(null)
    const [original, setOriginal] = useState<UsuarioApi | null>(null)
    const [form, setForm] = useState<Formulario>(FORMULARIO_VACIO)
    const [errores, setErrores] = useState<Record<string, string>>({})
    const [mensaje, setMensaje] = useState<string | null>(null)
    const [aviso, setAviso] = useState<string | null>(null)
    const [confirmacion, setConfirmacion] = useState<UsuarioApi | null>(null)
    const refCancelar = useRef<HTMLButtonElement>(null)
    const guardando = crear.isPending || editar.isPending

    useEffect(() => { if (confirmacion) refCancelar.current?.focus() }, [confirmacion])

    const listado = useMemo(() => (usuarios.data ?? []).filter((u) => {
        if (estadoFiltro === 'activos' && u.activo === false) return false
        if (estadoFiltro === 'inactivos' && u.activo !== false) return false
        const texto = normalizar(`${u.nombre} ${u.correo} ${u.rol}`)
        return texto.includes(normalizar(busqueda.trim()))
    }), [usuarios.data, busqueda, estadoFiltro])

    const rolSeleccionado = roles.data?.find((r) => r.clave === form.rol)
    const actualizar = <K extends keyof Formulario,>(campo: K, valor: Formulario[K]) => {
        setForm((f) => ({ ...f, [campo]: valor }))
        setErrores((e) => {
            const copia = { ...e }
            delete copia[campo]
            if (campo === 'edificiosTexto') delete copia.edificios
            delete copia._general
            return copia
        })
        setMensaje(null)
    }
    const empezarCrear = () => {
        setModo('crear'); setOriginal(null); setForm(FORMULARIO_VACIO); setErrores({}); setMensaje(null); setAviso(null)
    }
    const empezarEditar = (usuario: UsuarioApi) => {
        setModo('editar'); setOriginal(usuario); setForm(formDeUsuario(usuario)); setErrores({}); setMensaje(null); setAviso(null)
    }
    const cerrarFormulario = () => {
        setModo(null); setOriginal(null); setForm(FORMULARIO_VACIO); setErrores({}); setMensaje(null)
    }

    async function guardar(evento: FormEvent<HTMLFormElement>) {
        evento.preventDefault()
        if (guardando || !modo) return
        if (!rolSeleccionado) { setErrores({ rol: 'Selecciona un rol válido' }); return }
        const resultado = construirEntrada(form, rolSeleccionado, modo, original)
        if (Object.keys(resultado.errores).length) { setErrores(resultado.errores); return }
        try {
            if (modo === 'crear') await crear.mutateAsync(resultado.datos as UsuarioIn)
            else if (original) await editar.mutateAsync({ id: original._id, datos: resultado.datos as UsuarioPatch })
            setAviso(modo === 'crear' ? 'Usuario creado correctamente' : 'Cambios guardados correctamente')
            cerrarFormulario()
        } catch (e) {
            if (e instanceof ApiError) {
                if (modo === 'crear' && e.status === 409) { setErrores({ correo: 'Ya existe un usuario con ese correo' }); setMensaje(null); return }
                if (Object.keys(e.campos).length) { setErrores(e.campos); return }
            }
            setMensaje(mensajeDeError(e, 'No se pudieron guardar los cambios'))
        }
    }

    async function cambiarEstado() {
        if (!confirmacion || guardando) return
        const persona = confirmacion
        try {
            await editar.mutateAsync({ id: persona._id, datos: { activo: persona.activo === false } })
            setAviso(persona.activo === false ? 'Usuario reactivado correctamente' : 'Usuario desactivado correctamente')
            setConfirmacion(null)
            if (original?._id === persona._id) cerrarFormulario()
        } catch (e) {
            setConfirmacion(null)
            setAviso(null)
            setMensaje(mensajeDeError(e, 'No se pudo cambiar el estado del usuario'))
        }
    }

    // La ruta ya está protegida con RequirePermiso en App.tsx; esta comprobación evita una vista accidental sin acceso.
    if (!usuarioActual?.permisos.includes('usuarios:gestionar')) return <ErrorState titulo="Acceso restringido" mensaje="No tienes permiso para gestionar usuarios" />

    return (
        <div className="flex flex-col gap-5">
            <PageHeader titulo="Administración de usuarios" subtitulo="Consulta y gestiona las cuentas del campus" acciones={
                <Button icono={<Plus size={18} />} onClick={empezarCrear}>Nuevo usuario</Button>
            } />
            {aviso && <p role="status" className="rounded-lg border border-line bg-panel p-3 text-ok">{aviso}</p>}
            {!modo && mensaje && <p role="alert" className="rounded-lg border border-line bg-panel p-3 text-bad">{mensaje}</p>}

            <Card className="flex flex-col gap-4">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                    <Input etiqueta="Buscar usuario" placeholder="Nombre, correo o rol" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                    <Select etiqueta="Estado" value={estadoFiltro} onChange={(e) => setEstadoFiltro(e.target.value as EstadoFiltro)} opciones={[
                        { valor: 'todos', texto: 'Todos' }, { valor: 'activos', texto: 'Activos' }, { valor: 'inactivos', texto: 'Inactivos' },
                    ]} />
                </div>
                {usuarios.isPending || roles.isPending ? <SkeletonLista etiqueta="Cargando usuarios" /> :
                    usuarios.isError || roles.isError ? <ErrorState mensaje="No se pudieron cargar los usuarios o los roles" onReintentar={() => { void usuarios.refetch(); void roles.refetch() }} /> :
                        listado.length === 0 ? <EmptyState titulo="No se encontraron usuarios" descripcion="Ajusta la búsqueda o el filtro de estado." icono={Search} /> :
                            <>
                                <p className="text-sm text-muted" role="status">{listado.length} usuario(s) encontrado(s)</p>
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[680px] border-collapse text-left text-sm">
                                        <thead><tr className="border-b border-line text-muted">
                                            <th scope="col" className="p-3">Usuario</th><th scope="col" className="p-3">Rol</th>
                                            <th scope="col" className="p-3">Estado</th><th scope="col" className="p-3">Acciones</th>
                                        </tr></thead>
                                        <tbody>{listado.map((u) => {
                                            const activo = u.activo !== false
                                            const rol = roles.data?.find((r) => r.clave === u.rol)
                                            return <tr key={u._id} className="border-b border-line last:border-0">
                                                <td className="p-3"><span className="block font-semibold text-ink">{u.nombre}</span><span className="break-all text-muted">{u.correo}</span></td>
                                                <td className="p-3">{rol?.nombre ?? u.rol}</td>
                                                <td className="p-3"><span className={activo ? 'font-semibold text-ok' : 'font-semibold text-bad'}>{activo ? 'Activo' : 'Inactivo'}</span></td>
                                                <td className="p-3"><div className="flex flex-wrap gap-2">
                                                    <Button variante="secundario" icono={<Pencil size={16} />} onClick={() => empezarEditar(u)}>Editar</Button>
                                                    <Button variante={activo ? 'peligro' : 'secundario'} icono={activo ? <UserX size={16} /> : <UserCheck size={16} />}
                                                        disabled={guardando} onClick={() => setConfirmacion(u)}>
                                                        {activo ? 'Desactivar' : 'Reactivar'}
                                                    </Button>
                                                </div></td>
                                            </tr>
                                        })}</tbody>
                                    </table>
                                </div>
                            </>}
            </Card>

            {modo && (
                <Card como="section" aria-label={modo === 'crear' ? 'Formulario de alta' : 'Formulario de edición'} className="flex flex-col gap-4">
                    <h2 className="text-xl font-semibold text-ink">{modo === 'crear' ? 'Nuevo usuario' : `Editar: ${original?.nombre}`}</h2>
                    <form noValidate onSubmit={(e) => { void guardar(e) }} className="flex flex-col gap-4">
                        <div className="grid gap-4 md:grid-cols-2">
                            <Input etiqueta="Nombre completo" required value={form.nombre} maxLength={80} error={errores.nombre}
                                onChange={(e) => actualizar('nombre', e.target.value)} />
                            {modo === 'crear' ? <Input etiqueta="Correo institucional" required type="email" autoComplete="off" value={form.correo}
                                error={errores.correo} onChange={(e) => actualizar('correo', e.target.value)} /> :
                                <Input etiqueta="Correo institucional (no editable)" value={original?.correo ?? ''} disabled />}
                            <Select etiqueta="Rol" required value={form.rol} error={errores.rol} placeholder="Selecciona un rol"
                                opciones={(roles.data ?? []).map((r) => ({ valor: r.clave, texto: `${r.nombre} (${ETIQUETAS_ALCANCE[r.alcance]})` }))}
                                onChange={(e) => { actualizar('rol', e.target.value); setForm((f) => ({ ...f, rol: e.target.value, areas: [], edificiosTexto: '' })) }} />
                            <Select etiqueta="Tipo de reportante (opcional)" value={form.tipo_reportante} placeholder="No especificado"
                                opciones={Object.entries(ETIQUETAS_TIPO_REPORTANTE).map(([valor, texto]) => ({ valor, texto }))}
                                onChange={(e) => actualizar('tipo_reportante', e.target.value)} />
                        </div>

                        {rolSeleccionado?.alcance === 'area' && <fieldset className="rounded-lg border border-line p-4">
                            <legend className="px-2 font-semibold">Áreas autorizadas</legend>
                            <div className="flex flex-wrap gap-4">{CATEGORIAS.map((area) => <label key={area} className="flex min-h-11 items-center gap-2">
                                <input type="checkbox" className="h-5 w-5" checked={form.areas.includes(area)} onChange={(e) =>
                                    actualizar('areas', e.target.checked ? [...form.areas, area] : form.areas.filter((a) => a !== area))} />
                                {ETIQUETAS_CATEGORIA[area]}
                            </label>)}</div>
                            {errores.areas && <p role="alert" className="text-sm text-bad">{errores.areas}</p>}
                        </fieldset>}

                        {rolSeleccionado?.alcance === 'edificio' && <div>
                            <label htmlFor="admin-edificios" className="mb-1 block font-semibold">Edificios autorizados</label>
                            <textarea id="admin-edificios" rows={3} value={form.edificiosTexto} aria-invalid={Boolean(errores.edificios)}
                                aria-describedby={errores.edificios ? 'admin-edificios-error' : 'admin-edificios-ayuda'}
                                placeholder="Un edificio por línea (máximo 20)" onChange={(e) => actualizar('edificiosTexto', e.target.value)} />
                            <p id="admin-edificios-ayuda" className="text-sm text-muted">Separa los edificios por líneas o comas.</p>
                            {errores.edificios && <p id="admin-edificios-error" role="alert" className="text-sm text-bad">{errores.edificios}</p>}
                        </div>}

                        {modo === 'crear' && <div className="grid gap-4 md:grid-cols-2">
                            <Input etiqueta="Contraseña inicial" required type="password" autoComplete="new-password" value={form.password}
                                error={errores.password} ayuda="Mínimo 10 caracteres, mayúscula, minúscula, número y símbolo."
                                onChange={(e) => actualizar('password', e.target.value)} />
                            <Input etiqueta="Confirmar contraseña" required type="password" autoComplete="new-password" value={form.confirmarPassword}
                                error={errores.confirmarPassword} onChange={(e) => actualizar('confirmarPassword', e.target.value)} />
                        </div>}
                        {modo === 'editar' && <p className="text-sm text-muted">La contraseña no se consulta ni se muestra al editar usuarios.</p>}
                        {errores._general && <p role="alert" className="text-sm text-bad">{errores._general}</p>}
                        {mensaje && <p role="alert" className="text-sm text-bad">{mensaje}</p>}
                        <div className="flex flex-wrap justify-end gap-3">
                            <Button variante="secundario" onClick={cerrarFormulario} disabled={guardando}>Cancelar</Button>
                            <Button type="submit" cargando={guardando} textoCargando="Guardando…">{modo === 'crear' ? 'Crear usuario' : 'Guardar cambios'}</Button>
                        </div>
                    </form>
                </Card>
            )}

            {confirmacion && <div role="presentation" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                <div role="alertdialog" aria-modal="true" aria-labelledby="confirmar-titulo" aria-describedby="confirmar-detalle"
                    onKeyDown={(e) => { if (e.key === 'Escape' && !guardando) setConfirmacion(null) }}
                    className="w-full max-w-md rounded-xl border border-line bg-panel p-6 text-ink shadow-xl">
                    <h2 id="confirmar-titulo" className="mb-3 text-xl font-semibold">
                        {confirmacion.activo === false ? '¿Reactivar usuario?' : '¿Desactivar usuario?'}
                    </h2>
                    <p id="confirmar-detalle" className="mb-5 text-sm text-muted">
                        {confirmacion.activo === false ? `¿Quieres reactivar a ${confirmacion.nombre}?` :
                            `¿Quieres desactivar a ${confirmacion.nombre}? No podrá iniciar sesión ni ser seleccionado para nuevas asignaciones.`}
                    </p>
                    <div className="flex justify-end gap-3">
                        <button ref={refCancelar} type="button" className="ui-btn ui-btn--secundario" disabled={guardando} onClick={() => setConfirmacion(null)}>Cancelar</button>
                        <Button variante={confirmacion.activo === false ? 'primario' : 'peligro'} cargando={guardando}
                            onClick={() => { void cambiarEstado() }}>{confirmacion.activo === false ? 'Confirmar reactivación' : 'Confirmar desactivación'}</Button>
                    </div>
                </div>
            </div>}
        </div>
    )
}
