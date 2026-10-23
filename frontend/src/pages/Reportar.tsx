import { zodResolver } from '@hookform/resolvers/zod'
import imageCompression from 'browser-image-compression'
import { Camera } from 'lucide-react'
import { useRef, useState } from 'react'
import { useForm, useWatch, type RegisterOptions } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { useAnalizarImagen } from '../api/hooks/ia'
import { crearIncidencia } from '../api/incidencias'
import { EtiquetaSugerida, SugerenciaIA } from '../components/SugerenciaIA'
import type { AnalisisImagen } from '../schemas/ia'
import {
  CATEGORIAS, PRIORIDADES, incidenciaSchema, normalizarTag,
  type Categoria, type IncidenciaForm,
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

export default function Reportar() {
  const navigate = useNavigate()
  const entrada = useRef<HTMLInputElement>(null)
  const ignorarIA = useRef(false)
  const [paso, setPaso] = useState<'foto' | 'formulario'>('foto')
  const [vista, setVista] = useState<string | null>(null)
  const [contexto, setContexto] = useState('')
  const [procesando, setProcesando] = useState(false)
  const [sugerencia, setSugerencia] = useState<AnalisisImagen | null>(null)
  const [errorIA, setErrorIA] = useState<string | null>(null)
  const [criticaPendiente, setCriticaPendiente] = useState(false)
  const [camposAceptados, setCamposAceptados] = useState<string[]>([])
  const [camposEditados, setCamposEditados] = useState<string[]>([])
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null)
  const [tagsTexto, setTagsTexto] = useState('')

  const { register, handleSubmit, setValue, getFieldState, control, formState: { errors, isSubmitting } } = useForm<IncidenciaForm>({
    resolver: zodResolver(incidenciaSchema),
    defaultValues: {
      titulo: '', descripcion: '', prioridad: 'media', tags: [],
      ubicacion: { edificio: '', piso: null, aula: '' },
      detalle_especifico: detalleVacio('computo_redes'),
    },
  })
  const categoria = useWatch({ control, name: 'detalle_especifico.categoria' })
  const { mutate: analizar } = useAnalizarImagen()

  function marcarEditado(campo: string) {
    setCamposEditados((prev) => (prev.includes(campo) ? prev : [...prev, campo]))
    setCamposAceptados((prev) => prev.filter((c) => c !== campo))
    if (campo === 'prioridad') setCriticaPendiente(false)
  }

  type CampoIA = 'titulo' | 'descripcion' | 'prioridad' | 'tags' | 'detalle_especifico'
  const libre = (campo: CampoIA) => !getFieldState(campo).isDirty

  function cambiarCategoria(c: Categoria, editado = false) {
    setValue('detalle_especifico', detalleVacio(c), { shouldDirty: editado })
  }

  function aplicarSugerencia(s: AnalisisImagen) {
    if (ignorarIA.current) return
    setProcesando(false)
    setSugerencia(s)
    setErrorIA(null)
    if (!s.es_incidencia_valida) return

    const nuevos: string[] = []
    if (libre('titulo')) {
      setValue('titulo', s.titulo.slice(0, 120))
      nuevos.push('titulo')
    }
    if (libre('descripcion')) {
      setValue('descripcion', s.descripcion)
      nuevos.push('descripcion')
    }
    if (libre('prioridad')) {
      if (s.prioridad_sugerida === 'critica') {
        setCriticaPendiente(true)
      } else {
        setValue('prioridad', s.prioridad_sugerida)
        nuevos.push('prioridad')
      }
    }
    if (libre('tags')) {
      const tags = s.tags.map(normalizarTag)
      setValue('tags', tags)
      setTagsTexto(tags.join(', '))
      nuevos.push('tags')
    }
    if (s.categoria !== 'no_determinada' && libre('detalle_especifico')) {
      cambiarCategoria(s.categoria)
      nuevos.push('detalle_especifico.categoria')
    }
    setCamposAceptados((prev) => [...new Set([...prev, ...nuevos])])
  }

  async function alElegirFoto(archivo: File | undefined) {
    if (!archivo) return
    ignorarIA.current = false
    setPaso('formulario')
    setProcesando(true)
    setSugerencia(null)
    setErrorIA(null)
    setCriticaPendiente(false)
    try {
      const comprimida = await imageCompression(archivo, { maxWidthOrHeight: 1568, maxSizeMB: 1.5, fileType: 'image/jpeg', useWebWorker: true })
      if (ignorarIA.current) return
      setVista(URL.createObjectURL(comprimida))
      analizar({ imagen: comprimida, contexto: contexto.trim() || undefined }, {
        onSuccess: aplicarSugerencia,
        onError: (e) => {
          if (ignorarIA.current) return
          setProcesando(false)
          setErrorIA(e instanceof Error ? e.message : 'Intenta de nuevo en unos minutos.')
        },
      })
    } catch {
      if (ignorarIA.current) return
      setProcesando(false)
      setErrorIA('No se pudo procesar la foto. Intenta con otra imagen.')
    }
  }

  function continuarSinIA() {
    ignorarIA.current = true
    setPaso('formulario')
    setProcesando(false)
    setSugerencia(null)
    setErrorIA(null)
    setCriticaPendiente(false)
  }

  function confirmarCritica() {
    setValue('prioridad', 'critica')
    setCamposAceptados((prev) => [...new Set([...prev, 'prioridad'])])
    setCriticaPendiente(false)
  }

  async function enviar(datos: IncidenciaForm) {
    setErrorEnvio(null)
    try {
      await crearIncidencia(datos)
      navigate('/mis-tickets')
    } catch (e) {
      setErrorEnvio(e instanceof Error ? e.message : 'No se pudo crear la incidencia')
    }
  }

  // register de campos del detalle (la unión discriminada no se resuelve en tipos de ruta)
  const d = (nombre: string, opts?: RegisterOptions) =>
    register(`detalle_especifico.${nombre}` as 'detalle_especifico.categoria', {
      ...opts,
      onChange: () => marcarEditado('detalle_especifico'),
    } as never)
  const num = { valueAsNumber: true } as RegisterOptions
  const errD = errors.detalle_especifico as Record<string, { message?: string }> | undefined

  if (paso === 'foto') {
    return (
      <>
        <h1 className="titulo-pagina">Reportar</h1>
        <div className="card flex flex-col gap-4 py-6">
          <p className="m-0 text-center text-muted">Toma una foto del problema y la IA te ayudará a llenar el reporte.</p>
          <label className="etiqueta" htmlFor="contexto">Contexto para la IA (opcional)</label>
          <textarea
            id="contexto"
            rows={2}
            maxLength={500}
            value={contexto}
            placeholder="Ej. el proyector no enciende desde ayer"
            onChange={(e) => setContexto(e.target.value)}
          />
          <input ref={entrada} type="file" accept="image/*" capture="environment" hidden aria-label="Foto de la incidencia" onChange={(e) => alElegirFoto(e.target.files?.[0])} />
          <button className="btn w-full" style={{ minHeight: 64, fontSize: 18 }} onClick={() => entrada.current?.click()}>
            <Camera aria-hidden /> Tomar foto
          </button>
          <button className="btn btn-secundario" onClick={continuarSinIA}>Continuar sin IA</button>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="titulo-pagina m-0">Nueva incidencia</h1>
        <button type="button" className="btn btn-secundario" onClick={continuarSinIA}>Continuar sin IA</button>
      </div>
      {vista && <img src={vista} alt="Foto de la incidencia" className="mb-3 max-h-56 rounded-card object-cover" />}
      <SugerenciaIA
        analizando={procesando}
        sugerencia={sugerencia}
        error={errorIA}
        criticaPendiente={criticaPendiente}
        camposAceptados={camposAceptados}
        camposEditados={camposEditados}
        onConfirmarCritica={confirmarCritica}
        onDescartarCritica={() => setCriticaPendiente(false)}
      />

      <form aria-label="Reporte de incidencia" onSubmit={handleSubmit(enviar)} className="card">
        <label className="etiqueta" htmlFor="titulo">Título {camposAceptados.includes('titulo') && <EtiquetaSugerida confianza={sugerencia?.confianza} />}</label>
        <input id="titulo" {...register('titulo', { onChange: () => marcarEditado('titulo') })} />
        <Err msg={errors.titulo?.message} />
        <label className="etiqueta" htmlFor="descripcion">Descripción {camposAceptados.includes('descripcion') && <EtiquetaSugerida confianza={sugerencia?.confianza} />}</label>
        <textarea id="descripcion" rows={4} {...register('descripcion', { onChange: () => marcarEditado('descripcion') })} />
        <Err msg={errors.descripcion?.message} />
        <label className="etiqueta" htmlFor="prioridad">Prioridad {camposAceptados.includes('prioridad') && <EtiquetaSugerida confianza={sugerencia?.confianza} />}</label>
        <select id="prioridad" {...register('prioridad', { onChange: () => marcarEditado('prioridad') })}>
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

        <label className="etiqueta" htmlFor="categoria">Categoría {camposAceptados.includes('detalle_especifico.categoria') && <EtiquetaSugerida confianza={sugerencia?.confianza} />}</label>
        <select
          id="categoria"
          value={categoria}
          onChange={(e) => {
            marcarEditado('detalle_especifico')
            cambiarCategoria(e.target.value as Categoria, true)
          }}
        >
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

        <label className="etiqueta" htmlFor="tags">Tags (separados por coma) {camposAceptados.includes('tags') && <EtiquetaSugerida confianza={sugerencia?.confianza} />}</label>
        <input
          id="tags"
          value={tagsTexto}
          onChange={(e) => {
            marcarEditado('tags')
            setTagsTexto(e.target.value)
            setValue('tags', e.target.value.split(',').map(normalizarTag).filter(Boolean), { shouldDirty: true })
          }}
        />
        <Err msg={errors.tags?.message} />

        {errorEnvio && <p className="campo-error" role="alert">{errorEnvio}</p>}
        <button className="btn mt-4 w-full" disabled={isSubmitting}>Enviar reporte</button>
      </form>
    </>
  )
}
