import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { BASE } from '../../api/client'

/** Por defecto el catálogo de ubicaciones está vacío: Reportar usa la captura libre salvo que la prueba lo sobrescriba. */
export const servidor = setupServer(
  http.get(`${BASE}/aulas/ubicaciones`, () => HttpResponse.json([])),
)
