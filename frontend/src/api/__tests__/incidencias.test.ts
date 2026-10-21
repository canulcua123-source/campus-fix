import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../client'
import { subirEvidencia } from '../evidencias'
import { incidenciaQuery, incidenciasQuery } from '../incidencias'
import { crearQueryClient } from '../queryClient'
import { respuesta, simularFetch } from './utilidades'

const item = {
  _id: '66f000000000000000000001',
  codigo: 'INC-2026-1019-RED-0001',
  titulo: 'Sin conexión en el laboratorio',
  categoria: 'computo_redes',
  estado: 'abierta',
  prioridad: 'alta',
  ubicacion: { edificio: 'A', piso: 2, aula: 'A-201' },
  tags: ['wifi'],
  fecha_creacion: '2026-10-19T14:00:00+00:00',
}

// Los hooks son `useQuery(incidenciasQuery(f))`: se prueba la misma queryOptions con un QueryClient real
// (sin DOM). MSW no hace falta: fetch se simula directamente.
describe('useIncidencias devuelve lista tipada', () => {
  it('pide con filtros limpios y valida con zod', async () => {
    const f = simularFetch(() => respuesta(200, [item]))
    const qc = crearQueryClient()
    const lista = await qc.fetchQuery(incidenciasQuery({ estado: 'abierta', edificio: '' }))
    expect(lista[0].codigo).toBe('INC-2026-1019-RED-0001')
    expect(lista[0].ubicacion.piso).toBe(2)
    expect(String(f.mock.calls[0][0])).toBe('http://localhost:8000/incidencias?estado=abierta')
    expect(incidenciasQuery({ estado: 'abierta', edificio: '' }).queryKey).toEqual(['incidencias', { estado: 'abierta' }])
  })

  it('lista fuera de contrato → ApiError contrato (sin reintentos)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = simularFetch(() => respuesta(200, [{ ...item, estado: 'perdida' }]))
    const qc = crearQueryClient()
    await expect(qc.fetchQuery(incidenciasQuery())).rejects.toMatchObject({ codigo: 'contrato' })
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('detalle tipado con historial y evidencias', async () => {
    simularFetch(() => respuesta(200, {
      ...item,
      descripcion: 'No hay red en todo el laboratorio',
      reportante: { usuario_id: 'u1', nombre: 'Ana' },
      detalle_especifico: { categoria: 'computo_redes', ip: '10.0.0.1', vlan: 10, puerto_uplink: 'Gi0/1', equipos_afectados: 20 },
      evidencias_adjuntas: [],
      horas_invertidas: 0,
      historial_seguimiento: [{ fecha: item.fecha_creacion, usuario_id: 'u1', estado_nuevo: 'abierta', comentario: 'Incidencia creada', horas: 0 }],
    }))
    const d = await crearQueryClient().fetchQuery(incidenciaQuery(item._id))
    expect(d.detalle_especifico.categoria).toBe('computo_redes')
    expect(d.historial_seguimiento).toHaveLength(1)
  })
})

describe('evidencias en 3 pasos', () => {
  it('firma → PUT con Content-Type exacto y sin Authorization → registro', async () => {
    const f = simularFetch(
      () => respuesta(200, { evidencia_id: 'e1', url_storage: 'evidencias/x.jpg', upload_url: 'https://bucket/put?firma', expira_en: 300 }),
      () => new Response(null, { status: 200 }),
      () => respuesta(201, { ok: true, evidencia_id: 'e1' }),
    )
    const archivo = new File([new Uint8Array(1234)], 'foto.jpg', { type: 'image/jpeg' })
    const r = await subirEvidencia('inc1', { archivo })
    expect(r).toEqual({ ok: true, evidencia_id: 'e1' })
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({ nombre_archivo: 'foto.jpg', tipo_mime: 'image/jpeg', peso_bytes: 1234 })
    const put = f.mock.calls[1]
    expect(put[0]).toBe('https://bucket/put?firma')
    expect(put[1]?.method).toBe('PUT')
    const h = new Headers(put[1]?.headers)
    expect(h.get('Content-Type')).toBe('image/jpeg')
    expect(h.get('Authorization')).toBeNull()
    expect(JSON.parse(String(f.mock.calls[2][1]?.body))).toEqual({ evidencia_id: 'e1' })
  })

  it('archivo > 10 MB o tipo no permitido se rechaza antes de pedir firma', async () => {
    const f = simularFetch(() => respuesta(200, {}))
    const gif = new File([new Uint8Array(10)], 'a.gif', { type: 'image/gif' })
    await expect(subirEvidencia('inc1', { archivo: gif })).rejects.toBeInstanceOf(ApiError)
    expect(f).not.toHaveBeenCalled()
  })
})
