import { describe, expect, it } from 'vitest'
import { confirmarAdhesion } from '../ia'
import { respuesta, simularFetch } from './utilidades'

describe('confirmar adhesion T-038', () => {
  it('envia solo la capacidad opaca y valida la respuesta publica', async () => {
    const coincidenciaId = 'A'.repeat(43)
    const fetch = simularFetch(() => respuesta(200, {
      ok: true,
      codigo: 'INC-2026-INF-0001',
      categoria: 'infraestructura',
      adhesiones: 1,
      registrada: true,
    }))

    await expect(confirmarAdhesion({ coincidencia_id: coincidenciaId })).resolves.toMatchObject({ adhesiones: 1 })
    expect(String(fetch.mock.calls[0][0])).toBe('http://localhost:8000/ia/duplicados/adhesiones')
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ coincidencia_id: coincidenciaId })
  })

  it('rechaza una respuesta que filtre datos ajenos', async () => {
    simularFetch(() => respuesta(200, {
      ok: true,
      codigo: 'INC-2026-INF-0001',
      categoria: 'infraestructura',
      adhesiones: 1,
      registrada: true,
      reportante: { nombre: 'Dato privado' },
    }))

    await expect(confirmarAdhesion({ coincidencia_id: 'A'.repeat(43) })).rejects.toMatchObject({ codigo: 'contrato' })
  })
})
