import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { Camera, ImagePlus, PencilLine, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useForm, useWatch, type Path } from 'react-hook-form'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { aulaQuery } from '../api/aulas'
import { ApiError } from '../api/client'
import { analizarImagen } from '../api/ia'
import { useCrearIncidencia, useEvidencia } from '../api/hooks/incidencias'
import type { ReanudarSubida } from '../api/evidencias'
import { AvisoCalidad } from '../components/AvisoCalidad'
import { CamposDetalleReporte } from '../components/CamposDetalleReporte'
import { SugerenciaIA } from '../components/SugerenciaIA'
import { Button, Card, Input, PageHeader, Select, Skeleton, Spinner, Textarea } from '../components/ui'
import { procesarFotoEnSegundoPlano } from '../lib/fotoEnSegundoPlano'
import { pistasCalidad, type CalidadCliente } from '../lib/calidad'
import { OPCIONES_CATEGORIA, OPCIONES_PRIORIDAD } from '../lib/etiquetas'
import { ACCEPT_FOTO, ErrorImagen } from '../lib/imagen'
import type { RespuestaIA } from '../schemas/ia'
import { incidenciaSchema, type Categoria, type IncidenciaCreada, type IncidenciaForm } from '../schemas/incidencia'
import ReporteEnviado, { type EstadoFoto } from './ReporteEnviado'

/** Rutas del formulario que tienen un campo visible: un 400 de la API en ellas se marca bajo el campo (UX-18). */
const RUTAS_CON_CAMPO = /^(titulo|descripcion|prioridad|tags|ubicacion\.(edificio|piso|aula)|detalle_especifico\.[a-z_]+)$/

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

function Err({ id, msg }: { id?: string; msg?: string }) {
  return msg ? <p id={id} className="campo-error">{msg}</p> : null
}

function normalizarTag(t: string): string {
  return t.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, '_')
}

export default function Reportar() {
  const navigate = useNavigate()
  const [parametros] = useSearchParams()
  const aulaId = parametros.get('aula')?.trim() ?? ''
  const aula = useQuery({ ...aulaQuery(aulaId), enabled: Boolean(aulaId) })
  const entrada = useRef<HTMLInputElement>(null)
  const montado = useRef(false)
  const operacionIA = useRef<AbortController | null>(null)
  const vistaUrl = useRef<string | null>(null)
  const [paso, setPaso] = useState<'foto' | 'formulario'>('foto')
  const [vista, setVista] = useState<string | null>(null)
  const [foto, setFoto] = useState<Blob | null>(null)
  const [analizando, setAnalizando] = useState(false)
  const [ia, setIa] = useState<RespuestaIA | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [contexto, setContexto] = useState('')
  const [criticaPendiente, setCriticaPendiente] = useState(false)
  const [camposIA, setCamposIA] = useState<string[]>([])
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null)
  const [tagsTexto, setTagsTexto] = useState('')
  const [creada, setCreada] = useState<IncidenciaCreada | null>(null)
  const [errorFoto, setErrorFoto] = useState<string | null>(null)
  const [estadoFoto, setEstadoFoto] = useState<EstadoFoto>('sin_foto')
  const [calidadPendiente, setCalidadPendiente] = useState<{ ia: Blob; pistas: CalidadCliente[] } | null>(null)
  const progresoFoto = useRef<ReanudarSubida>({}) // conserva firma y PUT hechos para reintentar solo el paso fallido

  const galeria = useRef<HTMLInputElement>(null)
  const { register, handleSubmit, setValue, setError, clearErrors, getFieldState, control, formState } = useForm<IncidenciaForm>({
    // Valida al salir del campo y, una vez tocado, al corregirlo (UX-15, doc §7.1).
    mode: 'onTouched',
    resolver: zodResolver(incidenciaSchema),
    defaultValues: {
      titulo: '', descripcion: '', prioridad: 'media', tags: [],
      ubicacion: { edificio: '', piso: null, aula: '' },
      detalle_especifico: detalleVacio('computo_redes'),
    },
  })
  // Leer dirtyFields en el render suscribe el formulario a su seguimiento (lo usa sinEditar).
  const { errors, isSubmitting, dirtyFields: _camposEditados } = formState
  const categoria = useWatch({ control, name: 'detalle_especifico.categoria' })
  const { mutateAsync: crear } = useCrearIncidencia()
  const { mutateAsync: subirFoto } = useEvidencia()
  const ubicacionFijada = Boolean(aula.data)

  useEffect(() => {
    if (!aula.data) return
    setValue('ubicacion.edificio', aula.data.ubicacion.edificio, { shouldValidate: true })
    setValue('ubicacion.piso', aula.data.ubicacion.piso, { shouldValidate: true })
    setValue('ubicacion.aula', aula.data.ubicacion.aula, { shouldValidate: true })
  }, [aula.data, setValue])

  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
      operacionIA.current?.abort()
      if (vistaUrl.current) URL.revokeObjectURL(vistaUrl.current)
    }
  }, [])

  /** Cambiar de categoría limpia los campos y errores del detalle anterior. */
  function cambiarCategoria(c: Categoria, porUsuario = false) {
    setValue('detalle_especifico', detalleVacio(c), { shouldDirty: porUsuario })
    clearErrors('detalle_especifico')
  }

  // El análisis llega mientras el formulario ya es editable: nunca pisa lo que el usuario escribió.
  const sinEditar = (campo: 'titulo' | 'descripcion' | 'prioridad' | 'tags' | 'detalle_especifico') =>
    !getFieldState(campo).isDirty

  function cancelarAnalisis() {
    operacionIA.current?.abort()
    operacionIA.current = null
    setAnalizando(false)
  }

  function continuarManual() {
    cancelarAnalisis()
    setPaso('formulario')
  }

  /** Aborta la petición en curso (no gasta más cupo) y deja el formulario manual. */
  function continuarSinIA() {
    cancelarAnalisis()
    setCriticaPendiente(false)
    setAviso('Continúas sin IA. Completa el formulario manualmente.')
  }

  function confirmarCritica() {
    setValue('prioridad', 'critica', { shouldDirty: true })
    setCriticaPendiente(false)
  }

  const marcaIA = (campo: Parameters<typeof sinEditar>[0]) =>
    camposIA.includes(campo) && sinEditar(campo)
      ? (
        <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-panel-2 px-2 py-0.5 text-xs font-semibold text-brand">
          <Sparkles size={12} aria-hidden /> Sugerido por IA
        </span>
      )
      : null

  function abrirCamara() {
    entrada.current?.click()
  }

  const vigente = (control: AbortController) =>
    montado.current && !control.signal.aborted && operacionIA.current === control

  /** Corre una operación cancelable (procesar y/o analizar); otra foto o "Continuar sin IA" la abortan. */
  async function conOperacion(tarea: (control: AbortController) => Promise<void>) {
    cancelarAnalisis()
    const control = new AbortController()
    operacionIA.current = control
    setAnalizando(true)
    setAviso(null)
    setCriticaPendiente(false)
    setCamposIA([])
    try {
      await tarea(control)
    } catch (e) {
      if (!vigente(control)) return
      setAviso(e instanceof ErrorImagen
        ? `${e.message} Puedes llenar el formulario sin foto.`
        : 'No se pudo analizar la imagen con IA. Puedes llenar el formulario manualmente.')
    } finally {
      if (montado.current && operacionIA.current === control) {
        operacionIA.current = null
        setAnalizando(false)
      }
    }
  }

  async function analizar(imagen: Blob, pistas: CalidadCliente[], control: AbortController) {
    const sugerencia = await analizarImagen(
      { imagen, contexto: contexto.trim() || undefined, calidad_cliente: pistas.length ? pistas : undefined },
      { signal: control.signal },
    )
    if (!vigente(control)) return
    setIa(sugerencia)
    // rechazar/preguntar: solo se muestra el mensaje; el usuario llena el formulario.
    if (sugerencia.accion_asistida === 'autollenar' || sugerencia.accion_asistida === 'sugerir') {
      const analisis = sugerencia.analisis
      const rellenados: string[] = []
      if (sinEditar('titulo')) {
        setValue('titulo', analisis.titulo.slice(0, 120))
        rellenados.push('titulo')
      }
      if (sinEditar('descripcion')) {
        setValue('descripcion', analisis.descripcion)
        rellenados.push('descripcion')
      }
      // "critica" nunca se autollena: se deja "alta" y se pide confirmación explícita.
      if (sinEditar('prioridad')) {
        setValue('prioridad', analisis.prioridad_sugerida === 'critica' ? 'alta' : analisis.prioridad_sugerida)
        setCriticaPendiente(analisis.prioridad_sugerida === 'critica')
        rellenados.push('prioridad')
      }
      if (sinEditar('tags')) {
        const tags = analisis.tags.map(normalizarTag)
        setValue('tags', tags)
        setTagsTexto(tags.join(', '))
        rellenados.push('tags')
      }
      if (analisis.categoria !== 'no_determinada' && sinEditar('detalle_especifico')) {
        cambiarCategoria(analisis.categoria)
        rellenados.push('detalle_especifico')
        if (analisis.categoria === 'infraestructura' && analisis.detalle_infra) {
          setValue('detalle_especifico', {
            categoria: 'infraestructura',
            tipo_dano: analisis.detalle_infra.tipo_dano,
            // Igual que el mapeo del servidor: riesgo "alto" nunca se autollena, lo confirma la persona.
            riesgo_seguridad: analisis.detalle_infra.riesgo_seguridad === 'alto' ? 'medio' : analisis.detalle_infra.riesgo_seguridad,
            requiere_insumos: false,
            requiere_contratista: false,
          })
        }
      }
      setCamposIA(rellenados)
    }
  }

  function alElegirFoto(archivo: File | undefined) {
    if (!archivo) return
    setCalidadPendiente(null)
    setPaso('formulario')
    void conOperacion(async (control) => {
      // Orientación EXIF + derivados JPEG sin metadatos (lib/imagen.ts); en un worker si se puede.
      const derivados = await procesarFotoEnSegundoPlano(archivo)
      if (!vigente(control)) return
      setFoto(derivados.evidencia)
      progresoFoto.current = {}
      if (vistaUrl.current) URL.revokeObjectURL(vistaUrl.current)
      vistaUrl.current = URL.createObjectURL(derivados.miniatura)
      setVista(vistaUrl.current)
      const pistas = pistasCalidad(derivados.calidad)
      if (pistas.length > 0) {
        // Aviso no bloqueante: el formulario sigue editable y la IA espera la decisión (no gasta cupo en una foto a repetir).
        setCalidadPendiente({ ia: derivados.ia, pistas })
        return
      }
      await analizar(derivados.ia, [], control)
    })
  }

  function usarFotoDeTodosModos() {
    if (!calidadPendiente) return
    const { ia: imagen, pistas } = calidadPendiente
    setCalidadPendiente(null)
    void conOperacion((control) => analizar(imagen, pistas, control))
  }

  function repetirFoto() {
    setCalidadPendiente(null)
    abrirCamara()
  }

  async function adjuntarFoto(incidenciaId: string) {
    if (!foto) return
    setErrorFoto(null)
    setEstadoFoto('subiendo')
    try {
      await subirFoto({ incidenciaId, archivo: foto, nombre: 'incidencia.jpg', reanudar: progresoFoto.current })
      if (montado.current) setEstadoFoto('subida')
    } catch (e) {
      if (!montado.current) return
      setErrorFoto(e instanceof Error ? e.message : 'No se pudo adjuntar la foto')
      setEstadoFoto('error')
    }
  }

  /** 400 de la API → mensaje bajo cada campo (FB-08); lo que no tiene campo va al aviso general. */
  function marcarErroresApi(e: ApiError): boolean {
    const sueltos: string[] = []
    let primero = true
    for (const [ruta, mensaje] of Object.entries(e.campos)) {
      if (RUTAS_CON_CAMPO.test(ruta)) {
        setError(ruta as Path<IncidenciaForm>, { type: 'servidor', message: mensaje }, { shouldFocus: primero })
        primero = false
      } else {
        sueltos.push(mensaje)
      }
    }
    if (primero && sueltos.length === 0) return false
    setErrorEnvio(sueltos.length ? sueltos.join('. ') : 'Revisa los campos marcados')
    return true
  }

  async function enviar(datos: IncidenciaForm) {
    cancelarAnalisis()
    setErrorEnvio(null)
    try {
      const nueva = await crear(datos)
      setCreada(nueva)
      if (foto) await adjuntarFoto(nueva._id)
    } catch (e) {
      if (e instanceof ApiError && e.codigo === 'validacion' && marcarErroresApi(e)) return
      setErrorEnvio(e instanceof Error ? e.message : 'No se pudo crear la incidencia')
    }
  }

  function enviarFormulario(evento: FormEvent<HTMLFormElement>) {
    void handleSubmit(enviar)(evento)
  }

  if (creada) {
    return (
      <ReporteEnviado
        creada={creada}
        estadoFoto={estadoFoto}
        errorFoto={errorFoto}
        onReintentarFoto={() => void adjuntarFoto(creada._id)}
        onContinuarSinFoto={() => navigate('/mis-tickets')}
      />
    )
  }

  const entradaFoto = (
    <input
      ref={entrada}
      type="file"
      accept={ACCEPT_FOTO}
      capture="environment"
      hidden
      aria-label="Foto de la incidencia"
      onChange={(e) => {
        alElegirFoto(e.target.files?.[0])
        e.target.value = '' // permite volver a elegir la misma foto al repetir
      }}
    />
  )
  // Alternativa a la cámara: mismo procesamiento, sin `capture` (abre la galería/archivos).
  const entradaGaleria = (
    <input
      ref={galeria}
      type="file"
      accept={ACCEPT_FOTO}
      hidden
      aria-label="Foto desde la galería"
      onChange={(e) => {
        alElegirFoto(e.target.files?.[0])
        e.target.value = ''
      }}
    />
  )

  if (paso === 'foto') {
    return (
      <>
        <PageHeader titulo="Reportar" subtitulo="Toma una foto del problema y la IA te ayudará a llenar el reporte." />
        <Card como="section" className="mx-auto flex w-full max-w-md flex-col gap-4">
          {entradaFoto}
          {entradaGaleria}
          <Button tamano="lg" bloque icono={<Camera size={22} aria-hidden />} cargando={analizando} textoCargando="Analizando…" onClick={abrirCamara}>
            Tomar foto
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variante="secundario" icono={<ImagePlus size={18} aria-hidden />} disabled={analizando} onClick={() => galeria.current?.click()}>
              Galería
            </Button>
            <Button variante="secundario" icono={<PencilLine size={18} aria-hidden />} disabled={analizando} onClick={continuarManual}>
              Llenar sin foto
            </Button>
          </div>
          <Textarea
            etiqueta="Contexto para la IA (opcional)"
            ayuda="Ayuda a la IA a entender la foto. Máximo 500 caracteres."
            rows={2}
            maxLength={500}
            value={contexto}
            placeholder="Ej. el proyector no enciende desde ayer"
            onChange={(e) => setContexto(e.target.value)}
          />
        </Card>
        <ol className="mx-auto mt-4 flex w-full max-w-md justify-between gap-2 text-xs text-muted" aria-label="Pasos para reportar">
          <li><strong className="text-ink">1.</strong> Foto</li>
          <li>2. Revisa el formulario</li>
          <li>3. Envía y recibe tu folio</li>
        </ol>
      </>
    )
  }

  return (
    <>
      <h1 className="titulo-pagina">Nueva incidencia</h1>
      {entradaFoto}
      {vista && (
        <div className="relative mb-3 w-fit max-w-full overflow-hidden rounded-card">
          <img src={vista} alt="Foto de la incidencia" className="block max-h-56 object-cover" />
          {analizando && (
            <div aria-hidden className="absolute inset-0 flex items-center justify-center bg-canvas/60 backdrop-blur-[2px]">
              <span className="flex items-center gap-2 rounded-full bg-panel px-3 py-1.5 text-sm font-semibold text-accent shadow">
                <Sparkles size={16} className="animate-pulse" /> Analizando…
              </span>
            </div>
          )}
        </div>
      )}
      {analizando && (
        <Card role="status" aria-live="polite" className="mb-3 flex flex-col gap-3 border-[var(--color-secondary)]">
          <div className="flex items-start gap-3">
            <Spinner tamano={24} etiqueta="Analizando con IA" className="mt-0.5 shrink-0 text-accent" />
            <div>
              <p className="m-0 font-semibold">Analizando la foto con IA…</p>
              <p className="m-0 text-sm text-muted">Llenaremos título, descripción, categoría y prioridad. Puedes seguir escribiendo; no borraremos lo que cambies.</p>
            </div>
          </div>
          <div aria-hidden className="flex flex-col gap-2">
            <Skeleton ancho="70%" alto={12} />
            <Skeleton ancho="90%" alto={12} />
            <Skeleton ancho="45%" alto={12} />
          </div>
          <Button variante="secundario" className="self-start" onClick={continuarSinIA}>Continuar sin IA</Button>
        </Card>
      )}
      {calidadPendiente && (
        <AvisoCalidad pistas={calidadPendiente.pistas} onRepetir={repetirFoto} onUsar={usarFotoDeTodosModos} />
      )}
      {aviso && <p role="status" className="card mb-3 text-sm">{aviso}</p>}
      {aulaId && aula.isPending && <p role="status" className="card mb-3 text-sm">Comprobando la ubicación del código QR…</p>}
      {aulaId && aula.isError && (
        <p role="alert" className="card mb-3 text-sm text-warn">
          No pudimos reconocer el aula del código QR. Puedes seleccionar la ubicación manualmente.
        </p>
      )}
      {aula.data && (
        <p role="status" className="card mb-3 text-sm text-ok">
          Ubicación fijada por el código QR: {aula.data.ubicacion.edificio}, piso {aula.data.ubicacion.piso}, aula {aula.data.ubicacion.aula}.
        </p>
      )}
      {ia && <SugerenciaIA respuesta={ia} />}
      {criticaPendiente && (
        <Card role="alert" className="mb-3 text-sm">
          <p className="m-0 font-semibold">La IA sugiere prioridad crítica</p>
          <p className="mb-3 mt-1 text-muted">
            Crítica se reserva para riesgos de seguridad o servicios caídos. Mientras no la confirmes se usará «alta».
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={confirmarCritica}>Sí, es crítica</Button>
            <Button variante="secundario" onClick={() => setCriticaPendiente(false)}>No, mantener alta</Button>
          </div>
        </Card>
      )}
      {ia && (ia.accion_asistida === 'autollenar' || ia.accion_asistida === 'sugerir') && (
        <div className="mb-3 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-panel-2 px-3 py-1 text-xs font-semibold text-brand">
            <Sparkles size={14} aria-hidden /> Sugerido por IA · confianza {Math.round(ia.analisis.confianza * 100)}%
          </span>
          {ia.analisis.campos_detectados.map((c) => (
            <span key={c.nombre} className="rounded-full border border-line bg-panel px-3 py-1 text-xs">{c.nombre}: {c.valor}</span>
          ))}
        </div>
      )}

      <form onSubmit={enviarFormulario} className="card" noValidate>
        {marcaIA('titulo')}
        <Input etiqueta="Título" maxLength={120} error={errors.titulo?.message} {...register('titulo')} />
        {marcaIA('descripcion')}
        <Textarea etiqueta="Descripción" rows={4} maxLength={2000} error={errors.descripcion?.message} {...register('descripcion')} />
        {marcaIA('prioridad')}
        <Select
          etiqueta="Prioridad"
          opciones={OPCIONES_PRIORIDAD}
          error={errors.prioridad?.message}
          {...register('prioridad', { onChange: () => setCriticaPendiente(false) })}
        />

        <Input etiqueta="Edificio" readOnly={ubicacionFijada} aria-readonly={ubicacionFijada}
          error={errors.ubicacion?.edificio?.message} {...register('ubicacion.edificio')} />
        <Input etiqueta="Piso (opcional)" type="number" inputMode="numeric" readOnly={ubicacionFijada} aria-readonly={ubicacionFijada}
          error={errors.ubicacion?.piso?.message}
          {...register('ubicacion.piso', { setValueAs: (v) => (v === '' || v == null ? null : Number(v)) })} />
        <Input etiqueta="Aula" readOnly={ubicacionFijada} aria-readonly={ubicacionFijada}
          error={errors.ubicacion?.aula?.message} {...register('ubicacion.aula')} />

        {marcaIA('detalle_especifico')}
        <Select
          etiqueta="Categoría"
          opciones={OPCIONES_CATEGORIA}
          value={categoria}
          onChange={(e) => cambiarCategoria(e.target.value as Categoria, true)}
        />
        <CamposDetalleReporte categoria={categoria} register={register} errores={errors.detalle_especifico} />

        {marcaIA('tags')}
        <Input
          etiqueta="Tags (separados por coma)"
          value={tagsTexto}
          aria-describedby={errors.tags ? 'tags-error' : undefined}
          aria-invalid={errors.tags ? true : undefined}
          onChange={(e) => {
            setTagsTexto(e.target.value)
            setValue('tags', e.target.value.split(',').map(normalizarTag).filter(Boolean), { shouldDirty: true })
          }}
        />
        <Err id="tags-error" msg={errors.tags?.message ?? (Array.isArray(errors.tags) ? 'Revisa los tags: 2 a 30 letras, números o _' : undefined)} />

        {errorEnvio && <p className="campo-error" role="alert">{errorEnvio}</p>}
        <Button type="submit" bloque className="mt-4" cargando={isSubmitting} textoCargando="Enviando…">Enviar reporte</Button>
      </form>
    </>
  )
}
