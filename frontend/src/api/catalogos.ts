import { queryOptions } from '@tanstack/react-query'
import { categoriaSchema, categoriasSchema, type CategoriaIn, type CategoriaPatch } from '../schemas/catalogos'
import { api } from './client'
import { claves } from './keys'

export const categoriasQuery = () =>
  queryOptions({
    queryKey: claves.categorias,
    queryFn: ({ signal }) => api('/categorias', { signal, schema: categoriasSchema }),
    staleTime: 10 * 60_000, // catálogo: casi no cambia
  })

/** POST /categorias (categorias:gestionar). 409 = clave o prefijo duplicado. */
export const crearCategoria = (datos: CategoriaIn) =>
  api('/categorias', { method: 'POST', json: datos, schema: categoriaSchema })

/** PATCH /categorias/{clave}: cambiar campos sube la versión; `activa: false` solo en personalizadas. */
export const editarCategoria = (clave: string, datos: CategoriaPatch) =>
  api(`/categorias/${encodeURIComponent(clave)}`, { method: 'PATCH', json: datos, schema: categoriaSchema })
