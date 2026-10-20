import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { api } from '../api/client'

const PERMISOS = [
  'incidencias:crear', 'incidencias:ver', 'incidencias:asignar', 'incidencias:buscar', 'evidencias:subir',
  'seguimiento:registrar', 'tags:gestionar', 'analitica:ver', 'usuarios:gestionar', 'roles:gestionar',
  'categorias:gestionar', 'ia:usar',
] as const

const esquema = z.object({
  clave: z.string().regex(/^[a-z_]{3,30}$/, 'Solo minúsculas y guion bajo (3 a 30)'),
  nombre: z.string().min(3, 'Mínimo 3 caracteres').max(50, 'Máximo 50 caracteres'),
  descripcion: z.string().max(200, 'Máximo 200 caracteres'),
  permisos: z.array(z.enum(PERMISOS)).min(1, 'Selecciona al menos un permiso'),
  alcance: z.enum(['propio', 'area', 'edificio', 'global']),
})
type RolForm = z.infer<typeof esquema>

export default function AdminRoles() {
  const [mensaje, setMensaje] = useState<string | null>(null)
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<RolForm>({
    resolver: zodResolver(esquema),
    defaultValues: { clave: '', nombre: '', descripcion: '', permisos: [], alcance: 'propio' },
  })

  async function enviar(datos: RolForm) {
    try {
      await api('/roles', { method: 'POST', json: datos })
      setMensaje('Rol creado')
      reset()
    } catch (e) {
      setMensaje(e instanceof Error ? e.message : 'Error al crear el rol')
    }
  }

  return (
    <>
      <h1 className="titulo-pagina">Nuevo rol</h1>
      <form onSubmit={handleSubmit(enviar)} className="card">
        <label className="etiqueta" htmlFor="clave">Clave</label>
        <input id="clave" {...register('clave')} />
        {errors.clave && <p className="campo-error">{errors.clave.message}</p>}
        <label className="etiqueta" htmlFor="nombre">Nombre</label>
        <input id="nombre" {...register('nombre')} />
        {errors.nombre && <p className="campo-error">{errors.nombre.message}</p>}
        <label className="etiqueta" htmlFor="descripcion">Descripción</label>
        <textarea id="descripcion" rows={2} {...register('descripcion')} />
        <label className="etiqueta" htmlFor="alcance">Alcance</label>
        <select id="alcance" {...register('alcance')}>
          <option value="propio">Propio</option>
          <option value="area">Área</option>
          <option value="edificio">Edificio</option>
          <option value="global">Global</option>
        </select>
        <fieldset className="mt-3 border-0 p-0">
          <legend className="etiqueta">Permisos</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {PERMISOS.map((p) => (
              <label key={p} className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" value={p} style={{ width: 20, minHeight: 20 }} {...register('permisos')} /> {p}
              </label>
            ))}
          </div>
          {errors.permisos && <p className="campo-error">{errors.permisos.message}</p>}
        </fieldset>
        {mensaje && <p role="status" className="mt-3 text-sm">{mensaje}</p>}
        <button className="btn mt-4" disabled={isSubmitting}>Crear rol</button>
      </form>
    </>
  )
}
