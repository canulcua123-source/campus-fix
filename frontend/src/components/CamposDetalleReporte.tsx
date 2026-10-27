import type { FieldErrors, RegisterOptions, UseFormRegister } from 'react-hook-form'
import { OPCIONES_PLATAFORMA, OPCIONES_RIESGO, OPCIONES_TIPO_DANO } from '../lib/etiquetas'
import type { Categoria, IncidenciaForm } from '../schemas/incidencia'
import { Input, Select } from './ui'

interface CamposDetalleReporteProps {
  categoria: Categoria
  register: UseFormRegister<IncidenciaForm>
  errores?: FieldErrors<IncidenciaForm>['detalle_especifico']
}

const NUMERO = { valueAsNumber: true } as RegisterOptions

/** Campos de `detalle_especifico` según la categoría (unión discriminada de IncidenciaIn, T-049). */
export function CamposDetalleReporte({ categoria, register, errores }: CamposDetalleReporteProps) {
  // La unión discriminada no se resuelve en los tipos de ruta de react-hook-form.
  const d = (nombre: string, opciones?: RegisterOptions) =>
    register(`detalle_especifico.${nombre}` as 'detalle_especifico.categoria', opciones as never)
  const error = (nombre: string) => (errores as Record<string, { message?: string }> | undefined)?.[nombre]?.message

  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="sr-only">Detalle de la categoría</legend>
      {categoria === 'computo_redes' && (
        <>
          <Input etiqueta="IP" inputMode="decimal" placeholder="10.0.0.5" error={error('ip')} {...d('ip')} />
          <Input etiqueta="VLAN" type="number" inputMode="numeric" error={error('vlan')} {...d('vlan', NUMERO)} />
          <Input etiqueta="Puerto uplink" error={error('puerto_uplink')} {...d('puerto_uplink')} />
          <Input
            etiqueta="Equipos afectados" type="number" inputMode="numeric"
            error={error('equipos_afectados')} {...d('equipos_afectados', NUMERO)}
          />
        </>
      )}
      {categoria === 'infraestructura' && (
        <>
          <Select etiqueta="Tipo de daño" opciones={OPCIONES_TIPO_DANO} error={error('tipo_dano')} {...d('tipo_dano')} />
          <Select
            etiqueta="Riesgo de seguridad" opciones={OPCIONES_RIESGO}
            error={error('riesgo_seguridad')} {...d('riesgo_seguridad')}
          />
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
          <Select etiqueta="Plataforma" opciones={OPCIONES_PLATAFORMA} error={error('plataforma')} {...d('plataforma')} />
          <Input etiqueta="Código de curso" placeholder="MAT-101" error={error('codigo_curso')} {...d('codigo_curso')} />
          <Input etiqueta="Periodo" placeholder="2026-1" error={error('periodo')} {...d('periodo')} />
          <Input
            etiqueta="Estudiantes impactados" type="number" inputMode="numeric"
            error={error('estudiantes_impactados')} {...d('estudiantes_impactados', NUMERO)}
          />
        </>
      )}
    </fieldset>
  )
}
