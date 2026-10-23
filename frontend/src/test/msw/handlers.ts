import { http, HttpResponse } from 'msw'
import { BASE } from '../../api/client'

export const handlers = [
  http.post(`${BASE}/incidencias`, () =>
    HttpResponse.json({ _id: '664f1c2e9b1e8a3d4c5b6a70', codigo: 'INC-2026-1023-INF-0001', estado: 'abierta' }, { status: 201 }),
  ),
]
