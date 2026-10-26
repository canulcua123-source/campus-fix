import { zodResolver } from '@hookform/resolvers/zod'
import imageCompression from 'browser-image-compression'
import { Camera, Sparkles } from 'lucide-react'
import { useRef, useState } from 'react'
import { useForm, useWatch, type RegisterOptions } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { CONFIG_IMAGEN, ErrorImagen, validarImagenEntrada } from '../lib/imagen'
import {
  CATEGORIAS, PRIORIDADES, analisisImagenSchema, incidenciaSchema,
  type AnalisisImagen, type Categoria, type IncidenciaForm,
} from '../schemas/incidencia'

const NOMBRES_CATEGORIA: Record<Categoria, string> = {
  computo_redes: 'Cómputo y redes', infraestructura: 'Infraestructura', academico: 'Académico',
}

function detalleVacio(c: Categoria): IncidenciaForm['detalle_especifico'] {
  switch (c) {
    case 'computo_redes':
      return { categoria: c, ip: '', vlan: 1, puerto_uplink: '', equipos_afectados: 1 }
    case 'infraestructura':
      return { categoria: c, tipo_dano: 'otro', riesgo_seguridad: 'bajo', requiere_insumos: false, requiere_contratista: false }
    case 'academico':
      return { categoria: c, plataforma: 'lms', codigo_curso: '', periodo: '', estudiantes_impactados: 0 }
  }
}

function Err({ msg }: { msg?: string }) {
  return msg ? <p className="campo-error">{msg}</p> : null
}

function normalizarTag(t: string): string {
  return t.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, '_')
}

export default function Reportar() {
  const navigate = useNavigate()
  const entrada = useRef<HTMLInputElement>(null)
  const [paso, setPaso] = useState<'foto' | 'formulario'>('foto')
  const [vista, setVista] = useState<string | null>(null)
  const [analizando, setAnalizando] = useState(false)
  const [ia, setIa] = useState<AnalisisImagen | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null)
  const [tagsTexto, setTagsTexto] = useState('')

  const { register, handleSubmit, setValue, control, formState: { errors, isSubmitting } } = useForm<IncidenciaForm>({
    resolver: zodResolver(incidenciaSchema),
    defaultValues: {
      titulo: '', descripcion: '', prioridad: 'media', tags: [],
      ubicacion: { edificio: '', piso: null, aula: '' },
      detalle_especifico: detalleVacio('computo_redes'),
    },
  })
  const categoria = useWatch({ control, name: 'detalle_especifico.categoria' })

  // register de campos del detalle (la unión discriminada no se resuelve en tipos de ruta)
  const d = (nombre: string, opts?: RegisterOptions) =>
    register(`detalle_especifico.${nombre}` as 'detalle_especifico.categoria', opts as never)
  const num = { valueAsNumber: true } as RegisterOptions

  function cambiarCategoria(c: Categoria) {
    setValue('detalle_especifico', detalleVacio(c))
  }

  async function alElegirFoto(archivo: File | undefined) {
    if (!archivo) return
    setAviso(null)
    try {
      validarImagenEntrada(archivo)
    } catch (error) {
      setAviso(error instanceof ErrorImagen ? error.message : 'No se pudo procesar la foto.')
      return
    }
    setAnalizando(true)
    try {
      const comprimida = await imageCompression(archivo, {
        maxWidthOrHeight: 1568,
        maxSizeMB: 1.5,
        fileType: 'image/jpeg',
        initialQuality: CONFIG_IMAGEN.calidadInicial,
        useWebWorker: true,
      })
      setVista(URL.createObjectURL(comprimida))
      const fd = new FormData()
      fd.append('imagen', comprimida, 'incidencia.jpg')
      const sugerencia = analisisImagenSchema.parse(await api('/ia/analizar-imagen', { method: 'POST', body: fd }))
      setIa(sugerencia)
      if (!sugerencia.es_incidencia_valida) {
        setAviso('La IA no reconoció una incidencia en la foto. Completa el formulario manualmente.')
      } else {
        setValue('titulo', sugerencia.titulo.slice(0, 120))
        setValue('descripcion', sugerencia.descripcion)
        setValue('prioridad', sugerencia.prioridad_sugerida)
        const tags = sugerencia.tags.map(normalizarTag)
        setValue('tags', tags)
        setTagsTexto(tags.join(', '))
        if (sugerencia.categoria !== 'no_determinada') cambiarCategoria(sugerencia.categoria)
      }
    } catch {
      setAviso('No se pudo analizar la imagen con IA. Puedes llenar el formulario manualmente.')
    } finally {
      setAnalizando(false)
      setPaso('formulario')
    }
  }

  async function enviar(datos: IncidenciaForm) {
    setErrorEnvio(null)
    try {
      await api('/incidencias', { method: 'POST', json: datos })
      navigate('/mis-tickets')
    } catch (e) {
      setErrorEnvio(e instanceof Error ? e.message : 'No se pudo crear la incidencia')
    }
  }

  const errD = errors.detalle_especifico as Record<string, { message?: string }> | undefined

  if (paso === 'foto') {
    return (
      <>
        <h1 className="titulo-pagina">Reportar</h1>
        <div className="card flex flex-col items-center gap-4 py-10 text-center">
          <p className="m-0 text-muted">Toma una foto del problema y la IA te ayudará a llenar el reporte.</p>
          {aviso && <p role="alert" className="m-0 text-sm text-danger">{aviso}</p>}
          <input ref={entrada} type="file" accept={CONFIG_IMAGEN.tiposEntrada.join(',')} capture="environment" hidden onChange={(e) => alElegirFoto(e.target.files?.[0])} />
          <button className="btn w-full max-w-xs" style={{ minHeight: 64, fontSize: 18 }} disabled={analizando} onClick={() => entrada.current?.click()}>
            <Camera aria-hidden /> {analizando ? 'Analizando…' : 'Tomar foto'}
          </button>
          <button className="btn btn-secundario" onClick={() => setPaso('formulario')}>Llenar sin foto</button>
        </div>
      </>
    )
  }

  return (
    <>
      <h1 className="titulo-pagina">Nueva incidencia</h1>
      {vista && <img src={vista} alt="Foto de la incidencia" className="mb-3 max-h-56 rounded-card object-cover" />}
      {aviso && <p role="status" className="card mb-3 text-sm">{aviso}</p>}
      {ia?.es_incidencia_valida && (
        <div className="mb-3 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-panel-2 px-3 py-1 text-xs font-semibold text-brand">
            <Sparkles size={14} aria-hidden /> Sugerido por IA · confianza {Math.round(ia.confianza * 100)}%
          </span>
          {ia.campos_detectados.map((c) => (
            <span key={c.nombre} className="rounded-full border border-line bg-panel px-3 py-1 text-xs">{c.nombre}: {c.valor}</span>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit(enviar)} className="card">
        <label className="etiqueta" htmlFor="titulo">Título</label>
        <input id="titulo" {...register('titulo')} />
        <Err msg={errors.titulo?.message} />
        <label className="etiqueta" htmlFor="descripcion">Descripción</label>
        <textarea id="descripcion" rows={4} {...register('descripcion')} />
        <Err msg={errors.descripcion?.message} />
        <label className="etiqueta" htmlFor="prioridad">Prioridad</label>
        <select id="prioridad" {...register('prioridad')}>
          {PRIORIDADES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>

        <label className="etiqueta" htmlFor="edificio">Edificio</label>
        <input id="edificio" {...register('ubicacion.edificio')} />
        <Err msg={errors.ubicacion?.edificio?.message} />
        <label className="etiqueta" htmlFor="piso">Piso (opcional)</label>
        <input id="piso" type="number" inputMode="numeric" {...register('ubicacion.piso', { setValueAs: (v) => (v === '' || v == null ? null : Number(v)) })} />
        <label className="etiqueta" htmlFor="aula">Aula</label>
        <input id="aula" {...register('ubicacion.aula')} />
        <Err msg={errors.ubicacion?.aula?.message} />

        <label className="etiqueta" htmlFor="categoria">Categoría</label>
        <select id="categoria" value={categoria} onChange={(e) => cambiarCategoria(e.target.value as Categoria)}>
          {CATEGORIAS.map((c) => <option key={c} value={c}>{NOMBRES_CATEGORIA[c]}</option>)}
        </select>

        {categoria === 'computo_redes' && (
          <>
            <label className="etiqueta" htmlFor="ip">IP</label>
            <input id="ip" inputMode="decimal" {...d('ip')} />
            <Err msg={errD?.ip?.message} />
            <label className="etiqueta" htmlFor="vlan">VLAN</label>
            <input id="vlan" type="number" inputMode="numeric" {...d('vlan', num)} />
            <Err msg={errD?.vlan?.message} />
            <label className="etiqueta" htmlFor="uplink">Puerto uplink</label>
            <input id="uplink" {...d('puerto_uplink')} />
            <Err msg={errD?.puerto_uplink?.message} />
            <label className="etiqueta" htmlFor="equipos">Equipos afectados</label>
            <input id="equipos" type="number" inputMode="numeric" {...d('equipos_afectados', num)} />
            <Err msg={errD?.equipos_afectados?.message} />
          </>
        )}
        {categoria === 'infraestructura' && (
          <>
            <label className="etiqueta" htmlFor="tipo_dano">Tipo de daño</label>
            <select id="tipo_dano" {...d('tipo_dano')}>
              {['filtracion', 'electrico', 'climatizacion', 'cerrajeria', 'luminaria', 'otro'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <label className="etiqueta" htmlFor="riesgo">Riesgo de seguridad</label>
            <select id="riesgo" {...d('riesgo_seguridad')}>
              {['bajo', 'medio', 'alto'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <label className="mt-3 flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" style={{ width: 20, minHeight: 20 }} {...d('requiere_insumos')} /> Requiere insumos
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" style={{ width: 20, minHeight: 20 }} {...d('requiere_contratista')} /> Requiere contratista
            </label>
          </>
        )}
        {categoria === 'academico' && (
          <>
            <label className="etiqueta" htmlFor="plataforma">Plataforma</label>
            <select id="plataforma" {...d('plataforma')}>
              <option value="lms">LMS</option>
              <option value="portal_calificaciones">Portal de calificaciones</option>
              <option value="correo">Correo</option>
            </select>
            <label className="etiqueta" htmlFor="curso">Código de curso</label>
            <input id="curso" placeholder="MAT-101" {...d('codigo_curso')} />
            <Err msg={errD?.codigo_curso?.message} />
            <label className="etiqueta" htmlFor="periodo">Periodo</label>
            <input id="periodo" placeholder="2026-1" {...d('periodo')} />
            <Err msg={errD?.periodo?.message} />
            <label className="etiqueta" htmlFor="impactados">Estudiantes impactados</label>
            <input id="impactados" type="number" inputMode="numeric" {...d('estudiantes_impactados', num)} />
            <Err msg={errD?.estudiantes_impactados?.message} />
          </>
        )}

        <label className="etiqueta" htmlFor="tags">Tags (separados por coma)</label>
        <input
          id="tags"
          value={tagsTexto}
          onChange={(e) => {
            setTagsTexto(e.target.value)
            setValue('tags', e.target.value.split(',').map(normalizarTag).filter(Boolean))
          }}
        />
        <Err msg={errors.tags?.message} />

        {errorEnvio && <p className="campo-error" role="alert">{errorEnvio}</p>}
        <button className="btn mt-4 w-full" disabled={isSubmitting}>Enviar reporte</button>
      </form>
    </>
  )
}
