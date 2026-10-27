import { useMemo, useState, type FormEvent } from 'react'
import { Check, Circle, Lock, Pencil, Plus, Search, UserCheck, UserX, Users } from 'lucide-react'
import { ApiError, mensajeDeError } from '../api/client'
import { useCrearUsuario, useEditarUsuario, useRoles, useUsuarios } from '../api/hooks/admin'
import { errorFortalezaPassword } from '../api/usuarios'
import { useAuth } from '../auth/store'
import { Aviso, Chip, Paso } from '../components/admin/PiezasAdmin'
import { DESCRIPCION_ALCANCE, etiquetaPermiso, iniciales, permisosAgrupados } from '../components/admin/permisos'
import {
    BarraFiltros, BottomSheet, Button, EmptyState, ErrorState, Input, PageHeader, Seccion, Segmentado, Select, SkeletonLista, Tabla, Textarea,
} from '../components/ui'
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

const REQUISITOS_PASSWORD: { texto: string; cumple: (p: string) => boolean }[] = [
    { texto: '10 caracteres', cumple: (p) => p.length >= 10 },
    { texto: 'Mayúscula y minúscula', cumple: (p) => /[a-záéíóúñ]/.test(p) && /[A-ZÁÉÍÓÚÑ]/.test(p) },
    { texto: 'Un número', cumple: (p) => /\d/.test(p) },
    { texto: 'Un símbolo', cumple: (p) => /[^\p{L}\p{N}\s]/u.test(p) },
]

/** Pista de fortaleza: solo visual; la validación real es errorFortalezaPassword (y el backend). */
function PistaPassword({ password }: { password: string }) {
    const cumplidos = REQUISITOS_PASSWORD.filter((r) => r.cumple(password)).length
    const nivel = !password ? 'Escribe una contraseña' : cumplidos === 4 ? 'Segura' : cumplidos >= 2 ? 'Regular' : 'Débil'
    return (
        <span className="flex flex-col gap-1">
            <span className="flex items-center gap-2">
                <span aria-hidden className="flex flex-1 gap-1">
                    {REQUISITOS_PASSWORD.map((r, i) => (
                        <span key={r.texto} className={`h-1 flex-1 rounded-full ${i < cumplidos ? (cumplidos === 4 ? 'bg-ok' : 'bg-warn') : 'bg-line'}`} />
                    ))}
                </span>
                <span className="text-xs font-semibold">{nivel}</span>
            </span>
            <span className="flex flex-wrap gap-x-3 gap-y-1">
                {REQUISITOS_PASSWORD.map((r) => {
                    const ok = r.cumple(password)
                    return (
                        <span key={r.texto} className={`inline-flex items-center gap-1 ${ok ? 'text-ok' : ''}`}>
                            {ok ? <Check size={12} aria-hidden /> : <Circle size={10} aria-hidden />}
                            {r.texto}<span className="sr-only">{ok ? ': cumple' : ': falta'}</span>
                        </span>
                    )
                })}
            </span>
        </span>
    )
}

/** Resumen de lo que permite un rol (alcance + permisos agrupados), para elegir con conocimiento. */
function ResumenRol({ rol }: { rol: Rol }) {
    return (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-panel-2 p-3 text-sm" aria-live="polite">
            <p className="font-semibold text-ink">Con este rol podrá:</p>
            <p className="text-muted">{DESCRIPCION_ALCANCE[rol.alcance]}.</p>
            {rol.permisos.length === 0 ? <p className="text-muted">Este rol no tiene permisos asignados.</p> : (
                <dl className="grid gap-1">
                    {permisosAgrupados(rol.permisos).map((g) => (
                        <div key={g.titulo} className="grid gap-x-2 sm:grid-cols-[120px_1fr]">
                            <dt className="text-muted">{g.titulo}</dt>
                            <dd className="text-ink">{g.permisos.map(etiquetaPermiso).join(', ')}</dd>
                        </div>
                    ))}
                </dl>
            )}
        </div>
    )
}

function alcanceDeUsuario(u: UsuarioApi, rol: Rol | undefined): string {
    if (!rol) return '—'
    if (rol.alcance === 'area') return (u.areas ?? []).map((a) => ETIQUETAS_CATEGORIA[a as keyof typeof ETIQUETAS_CATEGORIA] ?? a).join(', ') || 'Sin áreas'
    if (rol.alcance === 'edificio') return (u.edificios ?? []).join(', ') || 'Sin edificios'
    return ETIQUETAS_ALCANCE[rol.alcance]
}

export default function AdminUsuarios() {
    const usuarioActual = useAuth((s) => s.usuario)
    const usuarios = useUsuarios()
    const roles = useRoles()
    const crear = useCrearUsuario()
    const editar = useEditarUsuario()
    const [busqueda, setBusqueda] = useState('')
    const [rolFiltro, setRolFiltro] = useState('')
    const [estadoFiltro, setEstadoFiltro] = useState<EstadoFiltro>('todos')
    const [modo, setModo] = useState<Modo>(null)
    const [original, setOriginal] = useState<UsuarioApi | null>(null)
    const [form, setForm] = useState<Formulario>(FORMULARIO_VACIO)
    const [errores, setErrores] = useState<Record<string, string>>({})
    const [mensaje, setMensaje] = useState<string | null>(null)
    const [aviso, setAviso] = useState<string | null>(null)
    const [verPassword, setVerPassword] = useState(false)
    const [confirmacion, setConfirmacion] = useState<UsuarioApi | null>(null)
    const guardando = crear.isPending || editar.isPending

    const listado = useMemo(() => (usuarios.data ?? []).filter((u) => {
        if (estadoFiltro === 'activos' && u.activo === false) return false
        if (estadoFiltro === 'inactivos' && u.activo !== false) return false
        if (rolFiltro && u.rol !== rolFiltro) return false
        const texto = normalizar(`${u.nombre} ${u.correo} ${u.rol}`)
        return texto.includes(normalizar(busqueda.trim()))
    }), [usuarios.data, busqueda, rolFiltro, estadoFiltro])
    const filtrosActivos = (busqueda.trim() ? 1 : 0) + (rolFiltro ? 1 : 0) + (estadoFiltro !== 'todos' ? 1 : 0)
    const limpiarFiltros = () => { setBusqueda(''); setRolFiltro(''); setEstadoFiltro('todos') }

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
        setModo('crear'); setOriginal(null); setForm(FORMULARIO_VACIO); setErrores({}); setMensaje(null); setAviso(null); setVerPassword(false)
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

    const total = usuarios.data?.length ?? 0
    const reactivar = confirmacion?.activo === false

    return (
        <div className="pila">
            <PageHeader titulo="Usuarios" subtitulo="Cuentas del campus, su rol y qué reportes pueden ver" acciones={
                <Button icono={<Plus size={18} />} onClick={empezarCrear}>Nuevo usuario</Button>
            } />
            {aviso && <Aviso tipo="ok" onCerrar={() => setAviso(null)}>{aviso}</Aviso>}
            {!modo && mensaje && <Aviso tipo="error" onCerrar={() => setMensaje(null)}>{mensaje}</Aviso>}

            <BarraFiltros etiqueta="Filtros" activos={filtrosActivos}
                acciones={filtrosActivos > 0 && <Button variante="fantasma" tamano="sm" onClick={limpiarFiltros}>Limpiar</Button>}>
                <Input etiqueta="Buscar usuario" etiquetaOculta tamano="sm" type="search" icono={<Search size={16} />}
                    placeholder="Buscar por nombre, correo o rol" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                <Select etiqueta="Filtrar por rol" etiquetaOculta tamano="sm" value={rolFiltro} placeholder="Todos los roles"
                    opciones={(roles.data ?? []).map((r) => ({ valor: r.clave, texto: r.nombre }))} onChange={(e) => setRolFiltro(e.target.value)} />
                <Segmentado etiqueta="Estado de la cuenta" tamano="sm" valor={estadoFiltro} onCambio={setEstadoFiltro} opciones={[
                    { valor: 'todos', texto: 'Todos' }, { valor: 'activos', texto: 'Activos' }, { valor: 'inactivos', texto: 'Inactivos' },
                ]} />
            </BarraFiltros>

            {usuarios.isPending || roles.isPending ? <SkeletonLista etiqueta="Cargando usuarios" /> :
                usuarios.isError || roles.isError ? <ErrorState mensaje="No se pudieron cargar los usuarios o los roles" onReintentar={() => { void usuarios.refetch(); void roles.refetch() }} reintentando={usuarios.isFetching || roles.isFetching} /> :
                    total === 0 ? <EmptyState icono={Users} titulo="Aún no hay usuarios" descripcion="Crea la primera cuenta y asígnale un rol."
                        accion={<Button icono={<Plus size={18} />} onClick={empezarCrear}>Nuevo usuario</Button>} /> :
                        <Seccion titulo="Cuentas" descripcion={<span role="status">{listado.length === total ? `${total} usuarios` : `${listado.length} de ${total} usuarios`}</span>} sinPadding>
                            {listado.length === 0 ? <div className="p-4"><EmptyState compacto icono={Search} titulo="Ningún usuario coincide"
                                descripcion="Prueba con otro nombre o quita filtros." accion={<Button variante="secundario" tamano="sm" onClick={limpiarFiltros}>Limpiar filtros</Button>} /></div> :
                                <Tabla etiqueta="Usuarios" apilada className="ui-tabla--apilada-md">
                                    <thead><tr>
                                        <th scope="col">Usuario</th><th scope="col">Rol</th><th scope="col">Alcance</th>
                                        <th scope="col">Estado</th><th scope="col"><span className="sr-only">Acciones</span></th>
                                    </tr></thead>
                                    <tbody>{listado.map((u) => {
                                        const activo = u.activo !== false
                                        const rol = roles.data?.find((r) => r.clave === u.rol)
                                        return <tr key={u._id}>
                                            <td>
                                                <div className="flex min-w-0 items-center gap-3 text-left">
                                                    <span aria-hidden className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${activo ? 'bg-brand text-on-brand' : 'bg-panel-2 text-muted border border-line'}`}>{iniciales(u.nombre)}</span>
                                                    <span className="min-w-0">
                                                        <span className="block font-semibold text-ink">{u.nombre}</span>
                                                        <span className="block break-all text-sm text-muted">{u.correo}</span>
                                                    </span>
                                                </div>
                                            </td>
                                            <td data-label="Rol"><Chip tono="marca">{rol?.nombre ?? u.rol}</Chip></td>
                                            <td data-label="Alcance" className="text-sm">{alcanceDeUsuario(u, rol)}</td>
                                            <td data-label="Estado"><Chip tono={activo ? 'ok' : 'apagado'}>{activo ? 'Activo' : 'Inactivo'}</Chip></td>
                                            <td>
                                                <div className="flex flex-wrap justify-end gap-2">
                                                    <Button variante="secundario" tamano="sm" icono={<Pencil size={16} />} onClick={() => empezarEditar(u)}>Editar</Button>
                                                    <Button variante="fantasma" tamano="sm" icono={activo ? <UserX size={16} /> : <UserCheck size={16} />}
                                                        disabled={guardando} onClick={() => setConfirmacion(u)}>
                                                        {activo ? 'Desactivar' : 'Reactivar'}
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    })}</tbody>
                                </Tabla>}
                        </Seccion>}

            <BottomSheet abierto={modo !== null} onCerrar={() => { if (!guardando) cerrarFormulario() }}
                titulo={modo === 'editar' ? 'Editar usuario' : 'Nuevo usuario'}>
                {modo && (
                    <form noValidate aria-label={modo === 'crear' ? 'Formulario de alta' : 'Formulario de edición'} onSubmit={(e) => { void guardar(e) }} className="flex flex-col gap-5">
                        <Paso numero={1} titulo="Datos personales" ayuda={modo === 'crear' ? 'Así aparecerá en reportes y asignaciones.' : 'El correo no se puede cambiar.'}>
                            <Input etiqueta="Nombre completo" required value={form.nombre} maxLength={80} error={errores.nombre} autoComplete="off"
                                placeholder="Ej. María Pérez Gómez" onChange={(e) => actualizar('nombre', e.target.value)} />
                            {modo === 'crear' ? <Input etiqueta="Correo institucional" required type="email" autoComplete="off" value={form.correo}
                                placeholder="nombre@utm.edu.mx" error={errores.correo} onChange={(e) => actualizar('correo', e.target.value)} /> :
                                <Input etiqueta="Correo institucional" value={original?.correo ?? ''} disabled icono={<Lock size={16} />} />}
                            <Select etiqueta="Tipo de reportante (opcional)" value={form.tipo_reportante} placeholder="No especificado"
                                opciones={Object.entries(ETIQUETAS_TIPO_REPORTANTE).map(([valor, texto]) => ({ valor, texto }))}
                                onChange={(e) => actualizar('tipo_reportante', e.target.value)} />
                        </Paso>

                        <Paso numero={2} titulo="Acceso y rol" ayuda="El rol define qué puede hacer en la app.">
                            <Select etiqueta="Rol" required value={form.rol} error={errores.rol} placeholder="Elige un rol"
                                opciones={(roles.data ?? []).map((r) => ({ valor: r.clave, texto: r.nombre }))}
                                onChange={(e) => { actualizar('rol', e.target.value); setForm((f) => ({ ...f, rol: e.target.value, areas: [], edificiosTexto: '' })) }} />
                            {rolSeleccionado && <ResumenRol rol={rolSeleccionado} />}
                            {modo === 'crear' && <>
                                <Input etiqueta="Contraseña inicial" required type={verPassword ? 'text' : 'password'} autoComplete="new-password" value={form.password}
                                    error={errores.password} ayuda={<PistaPassword password={form.password} />}
                                    onChange={(e) => actualizar('password', e.target.value)} />
                                <Input etiqueta="Confirmar contraseña" required type={verPassword ? 'text' : 'password'} autoComplete="new-password" value={form.confirmarPassword}
                                    error={errores.confirmarPassword} onChange={(e) => actualizar('confirmarPassword', e.target.value)} />
                                <label className="flex min-h-11 items-center gap-2 text-sm">
                                    <input type="checkbox" className="h-5 w-5" checked={verPassword} onChange={(e) => setVerPassword(e.target.checked)} />
                                    Mostrar contraseñas
                                </label>
                            </>}
                            {modo === 'editar' && <p className="text-sm text-muted">La contraseña no se consulta ni se muestra al editar.</p>}
                        </Paso>

                        <Paso numero={3} titulo="Alcance" ayuda={!rolSeleccionado ? 'Elige un rol para ver qué reportes podrá consultar.'
                            : rolSeleccionado.alcance === 'area' ? 'Marca las áreas que atenderá.'
                                : rolSeleccionado.alcance === 'edificio' ? 'Indica los edificios que atenderá.'
                                    : `${DESCRIPCION_ALCANCE[rolSeleccionado.alcance]}. No necesitas configurar nada más.`}>
                            {rolSeleccionado?.alcance === 'area' && <div role="group" aria-label="Áreas autorizadas" aria-describedby={errores.areas ? 'admin-areas-error' : undefined}>
                                <div className="flex flex-wrap gap-2">{CATEGORIAS.map((area) => {
                                    const marcada = form.areas.includes(area)
                                    return <label key={area} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm ${marcada ? 'border-brand bg-panel-2 font-semibold text-ink' : 'border-line'}`}>
                                        <input type="checkbox" className="h-5 w-5" checked={marcada} onChange={(e) =>
                                            actualizar('areas', e.target.checked ? [...form.areas, area] : form.areas.filter((a) => a !== area))} />
                                        {ETIQUETAS_CATEGORIA[area]}
                                    </label>
                                })}</div>
                                {errores.areas && <p id="admin-areas-error" role="alert" className="ui-campo__error mt-2">{errores.areas}</p>}
                            </div>}
                            {rolSeleccionado?.alcance === 'edificio' && <Textarea etiqueta="Edificios autorizados" required rows={3} value={form.edificiosTexto}
                                error={errores.edificios} placeholder="Ej. Edificio A, Biblioteca" ayuda="Uno por línea o separados por comas (máximo 20)."
                                onChange={(e) => actualizar('edificiosTexto', e.target.value)} />}
                        </Paso>

                        {errores._general && <p role="alert" className="ui-campo__error">{errores._general}</p>}
                        {mensaje && <p role="alert" className="ui-campo__error">{mensaje}</p>}
                        <div className="ui-sheet__acciones mt-0!">
                            <Button variante="secundario" onClick={cerrarFormulario} disabled={guardando}>Cancelar</Button>
                            <Button type="submit" cargando={guardando} textoCargando="Guardando…">{modo === 'crear' ? 'Crear usuario' : 'Guardar cambios'}</Button>
                        </div>
                    </form>
                )}
            </BottomSheet>

            <BottomSheet abierto={confirmacion !== null} onCerrar={() => { if (!guardando) setConfirmacion(null) }}
                titulo={reactivar ? '¿Reactivar usuario?' : '¿Desactivar usuario?'}
                acciones={<>
                    <Button variante="secundario" disabled={guardando} onClick={() => setConfirmacion(null)}>Cancelar</Button>
                    <Button variante={reactivar ? 'primario' : 'peligro'} cargando={guardando}
                        onClick={() => { void cambiarEstado() }}>{reactivar ? 'Confirmar reactivación' : 'Confirmar desactivación'}</Button>
                </>}>
                {confirmacion && <p className="text-sm text-muted">
                    {reactivar ? `${confirmacion.nombre} podrá volver a iniciar sesión con su contraseña actual.` :
                        `${confirmacion.nombre} no podrá iniciar sesión ni recibir nuevas asignaciones. Puedes reactivarlo cuando quieras.`}
                </p>}
            </BottomSheet>
        </div>
    )
}
