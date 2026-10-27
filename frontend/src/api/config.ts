import { queryOptions } from '@tanstack/react-query'
import { configIaPatchSchema, configIaSchema, type ConfigIAPatch } from '../schemas/config'
import { api, validarEntrada } from './client'
import { claves } from './keys'

/** GET /config/ia (configuracion:gestionar). 503 si la configuración no está disponible. */
export const configIaQuery = () =>
  queryOptions({
    queryKey: claves.configIA,
    queryFn: ({ signal }) => api('/config/ia', { signal, schema: configIaSchema }),
  })

/** PATCH /config/ia: solo los campos que cambiaron; nunca vacío ni con null. */
export const editarConfigIa = (datos: ConfigIAPatch) =>
  api('/config/ia', { method: 'PATCH', json: validarEntrada(configIaPatchSchema, datos), schema: configIaSchema })
