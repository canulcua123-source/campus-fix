import { queryOptions } from '@tanstack/react-query'
import { resumenSistemaSchema, saludSistemaSchema } from '../schemas/sistema'
import { api } from './client'
import { claves } from './keys'

/** GET /sistema/salud (sistema:administrar): Mongo, Redis, almacenamiento, IA, versión y uptime. */
export const saludSistemaQuery = () =>
  queryOptions({
    queryKey: claves.sistemaSalud,
    queryFn: ({ signal }) => api('/sistema/salud', { signal, schema: saludSistemaSchema }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

/** GET /sistema/resumen (sistema:administrar): KPIs, alertas accionables, tops y carga de técnicos. */
export const resumenSistemaQuery = () =>
  queryOptions({
    queryKey: claves.sistemaResumen,
    queryFn: ({ signal }) => api('/sistema/resumen', { signal, schema: resumenSistemaSchema }),
    staleTime: 60_000,
  })
