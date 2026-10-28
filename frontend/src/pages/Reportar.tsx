import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { Camera, Check, ImagePlus, Lock, PencilLine, Send, ShieldAlert, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useForm, useWatch, type Path } from 'react-hook-form'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { aulaQuery } from '../api/aulas'
import { ApiError } from '../api/client'
import { analizarImagen, registrarEventoIA } from '../api/ia'
import { useCrearIncidencia, useEvidencia } from '../api/hooks/incidencias'
import type { ReanudarSubida } from '../api/evidencias'
import { AvisoCalidad } from '../components/AvisoCalidad'
import { CamposDetalleReporte } from '../components/CamposDetalleReporte'
import { SelectorUbicacion } from '../components/SelectorUbicacion'
import { SugerenciaIA } from '../components/SugerenciaIA'
import { Badge, Button, Card, Input, PageHeader, Seccion, Segmentado, Select, Skeleton, Spinner, Textarea } from '../components/ui'
import { procesarFotoEnSegundoPlano } from '../lib/fotoEnSegundoPlano'
import { pistasCalidad, type CalidadCliente } from '../lib/calidad'
import { ETIQUETAS_PRIORIDAD, OPCIONES_CATEGORIA } from '../lib/etiquetas'
import { ACCEPT_FOTO, ErrorImagen } from '../lib/imagen'
import type { EventoIAIn, RespuestaIA } from '../schemas/ia'
import { incidenciaSchema, LIMITES, PRIORIDADES, type Categoria, type IncidenciaCreada, type IncidenciaForm, type Prioridad } from '../schemas/incidencia'
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

const AYUDA_PRIORIDAD: Record<Prioridad, string> = {
  baja: 'Molestia menor; puede esperar.',
  media: 'Afecta tu trabajo, pero hay alternativa.',
  alta: 'Impide una clase o actividad.',
  critica: 'Riesgo de seguridad o servicio caído.',
}

const PASOS = ['Foto', 'Revisa', 'Envía'] as const

/** Indicador de los 3 pasos de Reportar (UX-29). */
function Pasos({ actual }: { actual: 1 | 2 | 3 }) {
  return (
    <ol className="m-0 flex list-none items-center gap-2 p-0 text-sm" aria-label="Pasos para reportar">
      {PASOS.map((texto, i) => {
        const n = i + 1
        const hecho = n < actual
        const activo = n === actual
        return (
          <li key={texto} className="flex flex-1 items-center gap-2" aria-current={activo ? 'step' : undefined}>
            <span
              className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                activo ? 'bg-brand text-on-brand' : hecho ? 'bg-accent text-on-accent' : 'border border-line-strong bg-panel text-muted'
              }`}
              aria-hidden
            >
              {hecho ? <Check size={14} /> : n}
            </span>
            <span className={activo ? 'font-semibold text-ink' : 'text-muted'}>
              {texto}
              {hecho && <span className="sr-only"> (listo)</span>}
            </span>
            {n < PASOS.length && <span className="h-px flex-1 bg-line" aria-hidden />}
          </li>
        )
      })}
    </ol>
  )
}

function normalizarTag(t: string): string {
  return t.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, '_')
}

/** Reportar en 3 pasos. "Reportar otro" remonta el flujo con una llave nueva (estado limpio). */
export default function Reportar() {
  const [ronda, setRonda] = useState(0)
  return <FlujoReporte key={ronda} onReportarOtro={() => setRonda((r) => r + 1)} />
}

function FlujoReporte({ onReportarOtro }: { onReportarOtro: () => void }) {
  const navigate = useNavigate()
  const [parametros] = useSearchParams()
  const aulaId = parametros.get('aula')?.trim() ?? ''
  const aula = useQuery({ ...aulaQuery(aulaId), enabled: Boolean(aulaId) })
  const entrada = useRef<HTMLInputElement>(null)
  const montado = useRef(false)
  const operacionIA = useRef<AbortController | null>(null)
  const vistaUrl = useRef<string | null>(null)
  /** Oferta de IA aún sin resolver: se cierra al enviar (servidor) o al descartarla (POST /ia/eventos). */
  const ofertaPendiente = useRef<string | null>(null)
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
  const prioridad = useWatch({ control, name: 'prioridad' })
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

  /** Reporta que la persona dejó la sugerencia; la telemetría nunca bloquea ni muestra errores al reportar. */
  function resolverOferta(evento: Exclude<EventoIAIn['evento'], 'editado'>) {
    const analisisId = ofertaPendiente.current
    ofertaPendiente.current = null
    if (!analisisId) return
    // Sin respuesta útil para la persona: si falla, la oferta vence sola y cuenta como sin respuesta.
    void Promise.resolve().then(() => registrarEventoIA({ analisis_id: analisisId, evento })).catch(() => undefined)
  }

  /** "Llenar sin IA" tras la sugerencia: limpia lo que llenó la IA (sin tocar lo editado) y sigue a mano. */
  function descartarSugerencia() {
    resolverOferta('fallback')
    if (camposIA.includes('titulo') && sinEditar('titulo')) setValue('titulo', '')
    if (camposIA.includes('descripcion') && sinEditar('descripcion')) setValue('descripcion', '')
    if (camposIA.includes('prioridad') && sinEditar('prioridad')) setValue('prioridad', 'media')
    if (camposIA.includes('tags') && sinEditar('tags')) {
      setValue('tags', [])
      setTagsTexto('')
    }
    if (camposIA.includes('detalle_especifico') && sinEditar('detalle_especifico')) cambiarCategoria('computo_redes')
    setIa(null)
    setCamposIA([])
    setCriticaPendiente(false)
    setAviso('Descartaste la sugerencia de IA. Completa el formulario manualmente.')
  }

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

  /** Marca "Sugerido por IA" (color secundario) sobre los campos que llenó la IA; desaparece al editarlos (UX-30). */
  const campoIA = (campo: Parameters<typeof sinEditar>[0], hijo: ReactNode) =>
    camposIA.includes(campo) && sinEditar(campo)
      ? (
        <div className="flex flex-col gap-1 border-l-2 border-accent pl-3">
          <span className="self-start"><Badge tipo="ia" /></span>
          {hijo}
        </div>
      )
      : hijo

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
    resolverOferta('deshecho') // otra foto reemplaza la sugerencia anterior sin usarla
    setIa(null) // no deja visible la sugerencia de la foto anterior
    try {
      await tarea(control)
    } catch (e) {
      if (!vigente(control)) return
      // El servidor ya manda un mensaje claro (límite diario, IA apagada, foto muy pequeña…): se muestra tal cual.
      setAviso(e instanceof ErrorImagen
        ? `${e.message} Puedes llenar el formulario sin foto.`
        : e instanceof ApiError && e.message
          ? `${e.message.replace(/\.$/, '')}. Puedes llenar el formulario manualmente.`
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
    ofertaPendiente.current = sugerencia.analisis_id
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
        setValue('descripcion', analisis.descripcion.slice(0, LIMITES.descripcion[1]))
        rellenados.push('descripcion')
      }
      // "critica" nunca se autollena: se deja "alta" y se pide confirmación explícita
      // (el aviso aparece aunque el usuario ya haya elegido otra prioridad).
      setCriticaPendiente(analisis.prioridad_sugerida === 'critica')
      if (sinEditar('prioridad')) {
        setValue('prioridad', analisis.prioridad_sugerida === 'critica' ? 'alta' : analisis.prioridad_sugerida)
        rellenados.push('prioridad')
      }
      if (sinEditar('tags')) {
        // Mismas reglas que el formulario: sin repetidos, formato válido y máximo 15.
        const tags = [...new Set(analisis.tags.map(normalizarTag))]
          .filter((t) => /^[a-z0-9_]{2,30}$/.test(t))
          .slice(0, LIMITES.tags_max)
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
      // El servidor compara con la sugerencia guardada y cierra la oferta como enviada, editada o fallback.
      const analisisId = ofertaPendiente.current
      const nueva = await crear(analisisId ? { ...datos, analisis_id: analisisId } : datos)
      ofertaPendiente.current = null
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
        onContinuarSinFoto={() => navigate('/mis-reportes')}
        onReportarOtro={onReportarOtro}
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
      <div className="contenido-estrecho mx-auto pila">
        <PageHeader titulo="Reportar" subtitulo="Toma una foto del problema y la IA te ayudará a llenar el reporte." />
        <Pasos actual={1} />
        <Card como="section" className="flex flex-col gap-4">
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
        <p className="m-0 flex items-start gap-2 text-sm text-muted">
          <Sparkles size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
          La IA solo propone: podrás revisar y cambiar todo antes de enviar.
        </p>
        <p className="m-0 flex items-start gap-2 text-sm text-muted" role="note">
          <ShieldAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            La foto se analiza con <strong className="font-semibold text-ink">Google Gemini</strong>, que puede usarla para mejorar
            sus servicios. Fotografía solo la falla: evita personas, rostros y datos personales.
          </span>
        </p>
      </div>
    )
  }

  const sugerenciaAplicada = ia && (ia.accion_asistida === 'autollenar' || ia.accion_asistida === 'sugerir')

  return (
    <div className="contenido-estrecho mx-auto pila">
      <PageHeader titulo="Nuevo reporte" subtitulo="Revisa los datos y envía tu reporte." />
      <Pasos actual={2} />
      {entradaFoto}

      <Card className="flex items-center gap-3 !p-3">
        {vista ? (
          <div className="relative size-20 shrink-0 overflow-hidden rounded-input">
            <img src={vista} alt="Foto de la incidencia" className="block size-full object-cover" />
            {analizando && (
              <div aria-hidden className="absolute inset-0 grid place-items-center bg-canvas/60 backdrop-blur-[2px]">
                <Sparkles size={20} className="animate-pulse text-accent" />
              </div>
            )}
          </div>
        ) : (
          <span className="grid size-20 shrink-0 place-items-center rounded-input bg-panel-2 text-muted" aria-hidden>
            <Camera size={26} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="m-0 font-semibold text-ink">{vista ? 'Foto adjunta' : 'Sin foto'}</p>
          <p className="m-0 text-sm text-muted">{vista ? 'Se enviará como evidencia.' : 'Una foto ayuda al técnico a entender el problema.'}</p>
        </div>
        <Button variante="secundario" tamano="sm" icono={<Camera size={16} />} disabled={analizando} onClick={abrirCamara}>
          {vista ? 'Cambiar' : 'Agregar'}
        </Button>
      </Card>

      {analizando && (
        <Card role="status" aria-live="polite" className="flex flex-col gap-3 border-[var(--color-secondary)]">
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
      {aviso && <p role="status" className="card m-0 text-sm">{aviso}</p>}
      {ia && <SugerenciaIA respuesta={ia} />}
      {criticaPendiente && (
        <Card role="alert" className="text-sm">
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
      {sugerenciaAplicada && (
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: 'var(--ia-bg)', color: 'var(--ia-text)' }}>
            <Sparkles size={14} aria-hidden /> Sugerido por IA · confianza {Math.round(ia.analisis.confianza * 100)}%
          </span>
          {ia.analisis.campos_detectados.map((c) => (
            <span key={c.nombre} className="rounded-full border border-line bg-panel px-3 py-1 text-xs">{c.nombre}: {c.valor}</span>
          ))}
          <Button variante="secundario" tamano="sm" icono={<X size={16} aria-hidden />} onClick={descartarSugerencia}>
            Llenar sin IA
          </Button>
        </div>
      )}

      <form onSubmit={enviarFormulario} className="pila" noValidate>
        <Seccion titulo="Qué pasa" descripcion="Describe la falla en pocas palabras.">
          <div className="pila">
            {campoIA('titulo', <Input etiqueta="Título" maxLength={120} placeholder="Ej. Proyector no enciende" error={errors.titulo?.message} {...register('titulo')} />)}
            {campoIA('descripcion', <Textarea etiqueta="Descripción" rows={4} maxLength={2000} error={errors.descripcion?.message} {...register('descripcion')} />)}
          </div>
        </Seccion>

        <Seccion titulo="Dónde" descripcion="Para que el técnico llegue directo.">
          <div className="pila">
            {aulaId && aula.isPending && <p role="status" className="m-0 text-sm text-muted">Comprobando la ubicación del código QR…</p>}
            {aulaId && aula.isError && (
              <p role="alert" className="m-0 text-sm text-warn">
                No pudimos reconocer el aula del código QR. Puedes seleccionar la ubicación manualmente.
              </p>
            )}
            {aula.data && (
              <p role="status" className="m-0 flex items-start gap-2 rounded-card border border-line bg-panel-2 p-3 text-sm text-ink">
                <Lock size={16} className="mt-0.5 shrink-0 text-ok" aria-hidden />
                <span>
                  <span className="block font-semibold">{aula.data.ubicacion.edificio}, piso {aula.data.ubicacion.piso}, aula {aula.data.ubicacion.aula}</span>
                  <span className="block text-muted">Ubicación fijada por el código QR.</span>
                </span>
              </p>
            )}
            <SelectorUbicacion control={control} register={register} setValue={setValue} errors={errors} fijada={ubicacionFijada} />
          </div>
        </Seccion>

        <Seccion titulo="Detalles de la categoría" descripcion="Datos que ayudan a asignar al área correcta.">
          <div className="pila">
            {campoIA('detalle_especifico', (
              <Select
                etiqueta="Categoría"
                opciones={OPCIONES_CATEGORIA}
                value={categoria}
                onChange={(e) => cambiarCategoria(e.target.value as Categoria, true)}
              />
            ))}
            <CamposDetalleReporte categoria={categoria} register={register} errores={errors.detalle_especifico} />
            {campoIA('tags', (
              <Input
                etiqueta="Tags (separados por coma)"
                value={tagsTexto}
                placeholder="Ej. proyector, hdmi"
                aria-describedby={errors.tags ? 'tags-error' : undefined}
                aria-invalid={errors.tags ? true : undefined}
                onChange={(e) => {
                  setTagsTexto(e.target.value)
                  setValue('tags', e.target.value.split(',').map(normalizarTag).filter(Boolean), { shouldDirty: true })
                }}
              />
            ))}
            <Err id="tags-error" msg={errors.tags?.message ?? (Array.isArray(errors.tags) ? 'Revisa los tags: 2 a 30 letras, números o _' : undefined)} />
          </div>
        </Seccion>

        <Seccion titulo="Prioridad" descripcion="¿Qué tanto afecta?">
          {campoIA('prioridad', (
            <div className="flex flex-col gap-2">
              <Segmentado<Prioridad>
                etiqueta="Prioridad"
                valor={prioridad}
                opciones={PRIORIDADES.map((p) => ({ valor: p, texto: ETIQUETAS_PRIORIDAD[p] }))}
                onCambio={(p) => {
                  setValue('prioridad', p, { shouldDirty: true, shouldValidate: true })
                  setCriticaPendiente(false)
                }}
              />
              <p className="m-0 text-sm text-muted" aria-live="polite">{AYUDA_PRIORIDAD[prioridad]}</p>
              <Err msg={errors.prioridad?.message} />
            </div>
          ))}
        </Seccion>

        <div className="sticky bottom-[calc(var(--tabbar-height)+var(--safe-bottom)+8px)] z-20 flex flex-col gap-2 rounded-card border border-line bg-panel p-3 shadow-lg lg:bottom-4">
          {errorEnvio && <p className="campo-error m-0" role="alert">{errorEnvio}</p>}
          <Button type="submit" tamano="lg" bloque icono={<Send size={20} />} cargando={isSubmitting} textoCargando="Enviando…">Enviar reporte</Button>
        </div>
      </form>
    </div>
  )
}
