import { normalizarTag, tagsSchema } from '../schemas/incidencia'

/** Una sola fuente de verdad: reutiliza el contrato Zod de POST/DELETE /tags. */
export { normalizarTag } from '../schemas/incidencia'

export type ValidacionTag =
    | { valido: true; tag: string }
    | { valido: false; mensaje: string }

/** Equivalente de `normalizar_tag` (Python) más la validación de 2-30 caracteres. */
export function validarTag(texto: string): ValidacionTag {
    const resultado = tagsSchema.safeParse({ tags: [texto] })
    if (!resultado.success) {
        return { valido: false, mensaje: resultado.error.issues[0]?.message ?? 'Etiqueta inválida' }
    }
    const tag = resultado.data.tags[0]
    return tag ? { valido: true, tag } : { valido: false, mensaje: 'Etiqueta inválida' }
}

export interface TagFrecuente {
    tag: string
    total: number
}

/** Prioriza las sugerencias del backend, sin repetir las etiquetas ya asignadas. */
export function filtrarSugerencias(
    frecuentes: readonly TagFrecuente[],
    actuales: readonly string[],
    texto: string,
): string[] {
    const consulta = normalizarTag(texto)
    const existentes = new Set(actuales)
    const vistos = new Set<string>()
    const resultado: string[] = []
    for (const item of frecuentes) {
        const evaluacion = validarTag(item.tag)
        if (!evaluacion.valido) continue
        const tag = evaluacion.tag
        if (existentes.has(tag) || vistos.has(tag) || !tag.includes(consulta)) continue
        vistos.add(tag)
        resultado.push(tag)
        if (resultado.length === 8) break
    }
    return resultado
}