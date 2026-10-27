import { zodResolver } from '@hookform/resolvers/zod'
import clsx from 'clsx'
import { FlaskConical, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useForm, useWatch, type Path } from 'react-hook-form'
import { ApiError, mensajeDeError } from '../api/client'
import { useConfigIA, useEditarConfigIA } from '../api/hooks/config'
import { Aviso } from '../components/admin/PiezasAdmin'
import { BottomSheet, Button, ErrorState, Input, PageHeader, Seccion, Skeleton } from '../components/ui'
import { CATEGORIAS_AGENTICAS, configIaFormSchema, type ConfigIA, type ConfigIAPatch } from '../schemas/config'
import { ETIQUETAS_CATEGORIA } from '../schemas/etiquetas'

const CAMPOS = Object.keys(configIaFormSchema.shape) as (keyof ConfigIA)[]

/** Campos cuyo valor difiere del guardado: es lo único que viaja en el PATCH. */
function cambiosEntre(original: ConfigIA, actual: ConfigIA): ConfigIAPatch {
  const cambios: Record<string, unknown> = {}
  for (const campo of CAMPOS) {
    const a = campo === 'categorias_agenticas' ? [...actual[campo]].sort() : actual[campo]
    const o = campo === 'categorias_agenticas' ? [...original[campo]].sort() : original[campo]
    if (JSON.stringify(a) !== JSON.stringify(o)) cambios[campo] = actual[campo]
  }
  return cambios as ConfigIAPatch
}

/** Interruptor accesible (role="switch") con texto de estado visible, no solo color. */
function Interruptor({ etiqueta, descripcion, activo, onCambio, disabled }: {
  etiqueta: string
  descripcion: string
  activo: boolean
  onCambio: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <span className="font-semibold text-ink">{etiqueta}</span>
        <span className="text-sm text-muted">{descripcion}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={activo}
        aria-label={etiqueta}
        disabled={disabled}
        onClick={() => onCambio(!activo)}
        className="flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-1 text-sm font-medium text-ink disabled:opacity-50"
      >
        <span aria-hidden className={clsx('relative inline-flex h-7 w-12 rounded-full transition-colors motion-reduce:transition-none', activo ? 'bg-brand' : 'bg-line-strong')}>
          <span className={clsx('absolute top-1 h-5 w-5 rounded-full bg-panel shadow transition-transform motion-reduce:transition-none', activo ? 'translate-x-6' : 'translate-x-1')} />
        </span>
        <span className="w-20 text-left">{activo ? 'Encendido' : 'Apagado'}</span>
      </button>
    </div>
  )
}

function Cargando() {
  return (
    <div role="status" aria-label="Cargando configuración" className="flex flex-col gap-4">
      {[0, 1].map((i) => (
        <div key={i} className="ui-seccion flex flex-col gap-3 p-4">
          <Skeleton ancho="40%" alto={20} />
          <Skeleton alto={44} />
          <Skeleton alto={44} />
        </div>
      ))}
    </div>
  )
}

export default function AdminConfiguracion() {
  const consulta = useConfigIA()
  return (
    <div className="contenido-estrecho pila pila--lg">
      <PageHeader titulo="Configuración" subtitulo="Asistente de IA y modo agéntico" />
      {consulta.isPending ? (
        <Cargando />
      ) : consulta.isError ? (
        consulta.error instanceof ApiError && consulta.error.status === 503 ? (
          <ErrorState
            titulo="La configuración no está disponible"
            mensaje="El servicio de configuración no responde por ahora. Espera unos minutos e inténtalo de nuevo."
            onReintentar={() => consulta.refetch()}
            reintentando={consulta.isFetching}
          />
        ) : (
          <ErrorState mensaje={mensajeDeError(consulta.error)} onReintentar={() => consulta.refetch()} reintentando={consulta.isFetching} />
        )
      ) : (
        <FormConfiguracion config={consulta.data} />
      )}
    </div>
  )
}

function FormConfiguracion({ config }: { config: ConfigIA }) {
  const editar = useEditarConfigIA()
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const [confirmar, setConfirmar] = useState<ConfigIAPatch | null>(null)
  const { register, handleSubmit, setValue, setError, reset, control, formState: { errors } } = useForm<ConfigIA>({
    resolver: zodResolver(configIaFormSchema),
    mode: 'onTouched',
    defaultValues: config,
  })
  const valores = useWatch({ control }) as ConfigIA
  const cambios = cambiosEntre(config, valores)
  const hayCambios = Object.keys(cambios).length > 0
  const agentico = valores.modo_agentico_habilitado
  const categorias = valores.categorias_agenticas ?? []

  const fijar = <K extends keyof ConfigIA>(campo: K, valor: ConfigIA[K]) =>
    setValue(campo as Path<ConfigIA>, valor as never, { shouldDirty: true, shouldTouch: true, shouldValidate: true })

  async function guardar(datos: ConfigIAPatch) {
    setConfirmar(null)
    setAviso(null)
    try {
      const nueva = await editar.mutateAsync(datos)
      reset(nueva)
      setAviso({ tipo: 'ok', texto: 'Configuración guardada' })
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.campos).length) {
        const sueltos: string[] = []
        let primero = true
        for (const [ruta, mensaje] of Object.entries(e.campos)) {
          const campo = ruta.split('.')[0] as keyof ConfigIA
          if (CAMPOS.includes(campo)) {
            setError(campo, { type: 'servidor', message: mensaje }, { shouldFocus: primero })
            primero = false
          } else sueltos.push(mensaje)
        }
        setAviso({ tipo: 'error', texto: sueltos.length ? sueltos.join('. ') : 'Revisa los campos marcados' })
      } else {
        setAviso({ tipo: 'error', texto: e instanceof ApiError && e.status === 503
          ? 'La configuración no está disponible por ahora. Tus cambios siguen aquí; intenta guardar en unos minutos.'
          : mensajeDeError(e, 'No se pudo guardar la configuración') })
      }
    }
  }

  const enviar = handleSubmit((actual) => {
    const datos = cambiosEntre(config, actual)
    if (!Object.keys(datos).length) return
    if (datos.modo_agentico_habilitado === true || datos.habilitada === false) setConfirmar(datos)
    else void guardar(datos)
  })

  const enciendeAgentico = confirmar?.modo_agentico_habilitado === true
  const apagaIA = confirmar?.habilitada === false

  return (
    <form className="pila pila--lg pb-24" onSubmit={enviar} noValidate>
      {aviso && <Aviso tipo={aviso.tipo} onCerrar={() => setAviso(null)}>{aviso.texto}</Aviso>}

      <Seccion titulo="Asistente de IA" descripcion="Análisis de fotos y sugerencias al reportar.">
        <div className="flex flex-col gap-4">
          <Interruptor
            etiqueta="Asistente de IA"
            descripcion={valores.habilitada
              ? 'Encendido: quienes reportan reciben sugerencias de la IA, siempre editables.'
              : 'Apagado: nadie recibe sugerencias; los reportes se llenan a mano.'}
            activo={valores.habilitada}
            onCambio={(v) => fijar('habilitada', v)}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              etiqueta="Límite diario por usuario"
              ayuda="Análisis por persona al día (1 a 1,000)."
              type="number" inputMode="numeric" min={1} max={1000} step={1}
              error={errors.limite_diario_usuario?.message}
              {...register('limite_diario_usuario', { valueAsNumber: true })}
            />
            <Input
              etiqueta="Límite diario global"
              ayuda="Análisis de todo el campus al día (1 a 100,000)."
              type="number" inputMode="numeric" min={1} max={100000} step={1}
              error={errors.limite_diario_global?.message}
              {...register('limite_diario_global', { valueAsNumber: true })}
            />
          </div>
        </div>
      </Seccion>

      <Seccion
        titulo="Modo agéntico"
        descripcion="La IA ejecuta acciones por su cuenta en categorías acotadas."
        acciones={<span className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs font-medium text-ink"><FlaskConical size={14} aria-hidden />Experimental</span>}
      >
        <div className="flex flex-col gap-4">
          <p className="m-0 flex gap-2 rounded-xl border border-line bg-panel-2 p-3 text-sm text-ink">
            <TriangleAlert size={18} aria-hidden className="mt-0.5 shrink-0 text-warn" />
            Debe permanecer apagado hasta que se apruebe el piloto. Enciéndelo solo con autorización.
          </p>
          <Interruptor
            etiqueta="Modo agéntico"
            descripcion={agentico ? 'Encendido: la IA puede actuar en las categorías elegidas, con los cupos de abajo.' : 'Apagado: la IA solo sugiere; no ejecuta acciones.'}
            activo={agentico}
            onCambio={(v) => fijar('modo_agentico_habilitado', v)}
          />
          <fieldset disabled={!agentico} className="m-0 flex flex-col gap-4 border-0 p-0 disabled:opacity-60">
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="ui-campo__etiqueta">Categorías agénticas</legend>
              {CATEGORIAS_AGENTICAS.map((c) => (
                <label key={c} className="flex min-h-11 items-center gap-3 text-ink">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={categorias.includes(c)}
                    onChange={(e) => fijar('categorias_agenticas', e.target.checked
                      ? [...categorias, c]
                      : categorias.filter((x) => x !== c))}
                  />
                  {ETIQUETAS_CATEGORIA[c]}
                </label>
              ))}
              {errors.categorias_agenticas?.message
                ? <p className="m-0 ui-campo__error" role="alert">{errors.categorias_agenticas.message}</p>
                : <p className="m-0 ui-campo__ayuda">Hasta 3 categorías.</p>}
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                etiqueta="Cupo diario por usuario"
                ayuda="Acciones por persona al día (1 a 100)."
                type="number" inputMode="numeric" min={1} max={100} step={1}
                error={errors.cupo_agentico_usuario_diario?.message}
                {...register('cupo_agentico_usuario_diario', { valueAsNumber: true })}
              />
              <Input
                etiqueta="Cupo por aula por hora"
                ayuda="Acciones por aula cada hora (1 a 100)."
                type="number" inputMode="numeric" min={1} max={100} step={1}
                error={errors.cupo_agentico_aula_hora?.message}
                {...register('cupo_agentico_aula_hora', { valueAsNumber: true })}
              />
            </div>
          </fieldset>
        </div>
      </Seccion>

      {hayCambios && (
        <div
          role="region"
          aria-label="Cambios sin guardar"
          className="z-20 flex items-center justify-between gap-3 border-t border-line bg-panel px-4 py-2 max-lg:fixed max-lg:inset-x-0 lg:sticky lg:bottom-4 lg:rounded-xl lg:border lg:shadow"
          style={{ bottom: 'calc(var(--tabbar-height) + var(--safe-bottom))' }}
        >
          <span className="text-sm font-medium text-ink">Cambios sin guardar</span>
          <div className="flex gap-2">
            <Button variante="secundario" tamano="sm" disabled={editar.isPending} onClick={() => { reset(config); setAviso(null) }}>Descartar</Button>
            <Button type="submit" tamano="sm" cargando={editar.isPending} textoCargando="Guardando…">Guardar</Button>
          </div>
        </div>
      )}

      <BottomSheet
        abierto={confirmar !== null}
        onCerrar={() => setConfirmar(null)}
        titulo={enciendeAgentico ? '¿Encender el modo agéntico?' : '¿Apagar el asistente de IA?'}
        acciones={(
          <>
            <Button variante="secundario" onClick={() => setConfirmar(null)}>Cancelar</Button>
            <Button variante="peligro" onClick={() => confirmar && void guardar(confirmar)}>
              {enciendeAgentico ? 'Encender y guardar' : 'Apagar y guardar'}
            </Button>
          </>
        )}
      >
        <div className="flex flex-col gap-2 text-sm text-ink">
          {enciendeAgentico && <p className="m-0">La IA podrá ejecutar acciones por su cuenta. Es experimental y debe seguir apagado hasta que se apruebe el piloto.</p>}
          {apagaIA && <p className="m-0">Nadie recibirá sugerencias de la IA al reportar; los formularios se llenarán a mano.</p>}
        </div>
      </BottomSheet>
    </form>
  )
}
