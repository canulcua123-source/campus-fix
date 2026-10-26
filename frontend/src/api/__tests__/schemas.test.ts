import { describe, expect, it } from 'vitest'
import {
  adhesionSchema, analisisImagenSchema, confirmarAdhesionSchema, posibleDuplicadoSchema, respuestaIaSchema,
} from '../../schemas/ia'
import {
  evidenciaFirmaSchema, evidenciaSchema, incidenciaSchema, normalizarTag, seguimientoSchema, tagsSchema, iaSugerenciaSchema,
} from '../../schemas/incidencia'
import { loginSchema, rolInSchema, usuarioInSchema, usuarioPatchSchema } from '../../schemas/usuario'

const base = {
  titulo: 'Sin red en lab',
  descripcion: 'No hay conexión en todo el laboratorio',
  prioridad: 'alta',
  ubicacion: { edificio: 'A', piso: 2, aula: 'A-201' },
  detalle_especifico: { categoria: 'computo_redes', ip: '10.0.0.1', vlan: 10, puerto_uplink: 'Gi0/1', equipos_afectados: 3 },
  tags: [],
}
type Obj = Record<string, unknown>
const con = (cambio: (b: Obj & typeof base) => void) => {
  const b = structuredClone(base) as Obj & typeof base
  cambio(b)
  return b
}
const ok = (v: unknown) => incidenciaSchema.safeParse(v).success
const infra = { categoria: 'infraestructura', tipo_dano: 'otro', riesgo_seguridad: 'bajo', requiere_insumos: true, requiere_contratista: false }
const aca = { categoria: 'academico', plataforma: 'lms', codigo_curso: 'MAT-101', periodo: '2026-1', estudiantes_impactados: 0 }

describe('limites iguales a pydantic (IncidenciaIn)', () => {
  it('acepta una muestra válida de cada categoría', () => {
    expect(ok(base)).toBe(true)
    expect(ok(con((b) => { b.detalle_especifico = infra as never }))).toBe(true)
    expect(ok(con((b) => { b.detalle_especifico = aca as never }))).toBe(true)
  })

  it.each([
    ['titulo', 5, 120],
    ['descripcion', 10, 2000],
  ] as const)('%s: min_length=%i, max_length=%i', (campo, min, max) => {
    expect(ok(con((b) => { b[campo] = 'x'.repeat(min) }))).toBe(true)
    expect(ok(con((b) => { b[campo] = 'x'.repeat(min - 1) }))).toBe(false)
    expect(ok(con((b) => { b[campo] = 'x'.repeat(max) }))).toBe(true)
    expect(ok(con((b) => { b[campo] = 'x'.repeat(max + 1) }))).toBe(false)
  })

  it.each(['edificio', 'aula'] as const)('ubicacion.%s: 1..60', (campo) => {
    expect(ok(con((b) => { b.ubicacion[campo] = '' }))).toBe(false)
    expect(ok(con((b) => { b.ubicacion[campo] = 'x'.repeat(60) }))).toBe(true)
    expect(ok(con((b) => { b.ubicacion[campo] = 'x'.repeat(61) }))).toBe(false)
  })

  it('ubicacion.piso: -5..50, entero, opcional/null', () => {
    for (const [v, esperado] of [[-5, true], [50, true], [-6, false], [51, false], [1.5, false], [null, true]] as const)
      expect(ok(con((b) => { b.ubicacion.piso = v as never })), String(v)).toBe(esperado)
    expect(ok(con((b) => { delete (b.ubicacion as Obj).piso }))).toBe(true)
  })

  it('computo_redes: vlan 1..4094, equipos 1..10000, puerto ≤ 20 sin mínimo, ip v4/v6', () => {
    const d = (cambio: Obj) => ok(con((b) => { Object.assign(b.detalle_especifico, cambio) }))
    expect([d({ vlan: 1 }), d({ vlan: 4094 }), d({ vlan: 0 }), d({ vlan: 4095 })]).toEqual([true, true, false, false])
    expect([d({ equipos_afectados: 1 }), d({ equipos_afectados: 10000 }), d({ equipos_afectados: 0 }), d({ equipos_afectados: 10001 })])
      .toEqual([true, true, false, false])
    expect([d({ puerto_uplink: '' }), d({ puerto_uplink: 'x'.repeat(20) }), d({ puerto_uplink: 'x'.repeat(21) })]).toEqual([true, true, false])
    expect([d({ ip: '::1' }), d({ ip: '300.1.1.1' }), d({ ip: '' })]).toEqual([true, false, false])
  })

  it('infraestructura: insumos ≤ 10 elementos de 1..60, null u omitido', () => {
    const d = (insumos: unknown) => ok(con((b) => { b.detalle_especifico = { ...infra, insumos } as never }))
    expect(d(Array(10).fill('cable'))).toBe(true)
    expect(d(Array(11).fill('cable'))).toBe(false)
    expect(d([''])).toBe(false)
    expect(d(['x'.repeat(60)])).toBe(true)
    expect(d(['x'.repeat(61)])).toBe(false)
    expect(d(null)).toBe(true)
    expect(d(undefined)).toBe(true)
  })

  it('academico: patrones de codigo_curso/periodo y estudiantes 0..100000', () => {
    const d = (cambio: Obj) => ok(con((b) => { b.detalle_especifico = { ...aca, ...cambio } as never }))
    expect([d({ codigo_curso: 'ISC-001' }), d({ codigo_curso: 'MATE-999' }), d({ codigo_curso: 'mat-101' }), d({ codigo_curso: 'M-101' })])
      .toEqual([true, true, false, false])
    expect([d({ periodo: '2026-2' }), d({ periodo: '2026-3' }), d({ periodo: '26-1' })]).toEqual([true, false, false])
    expect([d({ estudiantes_impactados: 100000 }), d({ estudiantes_impactados: 100001 }), d({ estudiantes_impactados: -1 })])
      .toEqual([true, false, false])
  })

  it('rechaza enums y categorías desconocidas', () => {
    expect(ok(con((b) => { b.prioridad = 'urgente' }))).toBe(false)
    expect(ok(con((b) => { b.detalle_especifico = { categoria: 'otra' } as never }))).toBe(false)
  })

  it('tags: normaliza como normalizar_tag, dedup + orden, ≤ 15, regex 2..30', () => {
    expect(normalizarTag('  Red Inalámbrica ')).toBe('red_inalambrica')
    const r = incidenciaSchema.parse(con((b) => { b.tags = ['WiFi', 'wifi', 'Aire Acondicionado'] as never }))
    expect(r.tags).toEqual(['aire_acondicionado', 'wifi'])
    expect(ok(con((b) => { b.tags = Array.from({ length: 15 }, (_, i) => `t${i}`) as never }))).toBe(true)
    expect(ok(con((b) => { b.tags = Array.from({ length: 16 }, (_, i) => `t${i}`) as never }))).toBe(false)
    expect(ok(con((b) => { b.tags = ['a'] as never }))).toBe(false)
    expect(ok(con((b) => { b.tags = ['x'.repeat(31)] as never }))).toBe(false)
    expect(ok(con((b) => { b.tags = ['con-guion'] as never }))).toBe(false)
  })
})

describe('otras entradas espejo de pydantic', () => {
  it('SeguimientoIn: horas 0..24, comentario 5..1000', () => {
    const s = (c: Obj) => seguimientoSchema.safeParse({ estado_nuevo: 'en_proceso', comentario: 'Revisado', horas: 1, ...c }).success
    expect([s({ horas: 0 }), s({ horas: 0.25 }), s({ horas: 1.75 }), s({ horas: 24 }), s({ horas: 24.25 })])
      .toEqual([true, true, true, true, false])
    expect([s({ horas: -0.25 }), s({ horas: 0.1 }), s({ horas: 1.1 }), s({ horas: 2.3 }), s({ horas: Number.POSITIVE_INFINITY })])
      .toEqual([false, false, false, false, false])
    expect([s({ comentario: 'x'.repeat(5) }), s({ comentario: 'x'.repeat(4) }), s({ comentario: 'x'.repeat(1001) })]).toEqual([true, false, false])
    expect(s({ estado_nuevo: 'reabierta' })).toBe(false)
  })

  it('TagsIn: al menos 1', () => {
    expect(tagsSchema.safeParse({ tags: [] }).success).toBe(false)
    expect(tagsSchema.parse({ tags: ['Cámara'] }).tags).toEqual(['camara'])
  })

  it('EvidenciaFirmaIn: peso ≤ 10 MB, mime permitido, nombre sin rutas', () => {
    const e = (c: Obj) => evidenciaFirmaSchema.safeParse({ nombre_archivo: 'a.jpg', tipo_mime: 'image/jpeg', peso_bytes: 1, ...c }).success
    expect([e({ peso_bytes: 10 * 1024 * 1024 }), e({ peso_bytes: 10 * 1024 * 1024 + 1 }), e({ peso_bytes: 0 })]).toEqual([true, false, false])
    expect([e({ tipo_mime: 'application/pdf' }), e({ tipo_mime: 'image/gif' })]).toEqual([true, false])
    expect([e({ nombre_archivo: 'dir/a.jpg' }), e({ nombre_archivo: 'a\\b' }), e({ nombre_archivo: 'a..jpg' }), e({ nombre_archivo: 'x'.repeat(121) })])
      .toEqual([false, false, false, false])
    expect(evidenciaSchema.safeParse({ evidencia_id: '0b6a3a8e-2f0e-4a51-9d64-2a8b1f6e7c11' }).success).toBe(true)
    expect(evidenciaSchema.safeParse({ evidencia_id: 'no-uuid' }).success).toBe(false)
  })

  it('RolIn y UsuarioIn', () => {
    const rol = { clave: 'jefe_lab', nombre: 'Jefe', descripcion: '', permisos: ['incidencias:ver'], alcance: 'area' }
    expect(rolInSchema.safeParse(rol).success).toBe(true)
    expect(rolInSchema.safeParse({ ...rol, clave: 'Jefe' }).success).toBe(false)
    expect(rolInSchema.safeParse({ ...rol, permisos: ['incidencias:ver', 'incidencias:ver'] }).success).toBe(false)
    expect(rolInSchema.safeParse({ ...rol, permisos: [] }).success).toBe(false)
    const u = { nombre: 'Ana', correo: 'Ana@UTM.EDU.MX', password: 'x'.repeat(10), rol: 'tecnico' }
    expect(usuarioInSchema.parse(u).correo).toBe('ana@utm.edu.mx')
    expect(usuarioInSchema.parse({ ...u, correo: ' ANA@UTM.EDU.MX ' }).correo).toBe('ana@utm.edu.mx')
    expect(usuarioInSchema.safeParse({ ...u, correo: 'ana@externo.edu.mx' }).success).toBe(false)
    expect(usuarioInSchema.safeParse({ ...u, correo: 'ana@evilutm.edu.mx' }).success).toBe(false)
    expect(usuarioInSchema.safeParse({ ...u, password: 'x'.repeat(9) }).success).toBe(false)
    expect(usuarioPatchSchema.safeParse({ areas: ['computo_redes', 'academico', 'infraestructura', 'computo_redes'] }).success).toBe(false)
    expect(usuarioInSchema.safeParse({ ...u, extra: true }).success).toBe(false)
    expect(usuarioPatchSchema.safeParse({ nombre: 'Ana', extra: true }).success).toBe(false)
    expect(rolInSchema.safeParse({ ...rol, extra: true }).success).toBe(false)
    expect(loginSchema.parse({ correo: ' ANA@UTM.EDU.MX ', password: 'secreto' }).correo).toBe('ana@utm.edu.mx')
    expect(loginSchema.safeParse({ correo: 'ana@externo.edu.mx', password: 'secreto' }).success).toBe(false)
    expect(loginSchema.safeParse({ correo: 'ana@utm.edu.mx', password: 'secreto', extra: true }).success).toBe(false)
  })
})

describe('respuesta de IA (AnalisisImagen, extra=forbid)', () => {
  const ia = {
    es_incidencia_valida: true, categoria: 'no_determinada', titulo: 't', descripcion: 'd', prioridad_sugerida: 'baja',
    tags: [], campos_detectados: [{ nombre: 'ip', valor: '10.0.0.1' }], confianza: 0.8, advertencias: [],
  }
  it('acepta válida y rechaza confianza fuera de 0..1 o campos extra', () => {
    expect(analisisImagenSchema.safeParse(ia).success).toBe(true)
    expect(analisisImagenSchema.safeParse({ ...ia, cache: false }).success).toBe(false)
    expect(analisisImagenSchema.safeParse({ ...ia, confianza: 1.1 }).success).toBe(false)
    expect(analisisImagenSchema.safeParse({ ...ia, extra: 1 }).success).toBe(false)
  })

  it('valida la respuesta con acción, mensaje, análisis y caché', () => {
    const respuesta = { accion: 'autollenar', mensaje: 'Revisa los datos', analisis: ia, cache: false }
    expect(respuestaIaSchema.safeParse(respuesta).success).toBe(true)
    expect(respuestaIaSchema.safeParse({ ...respuesta, accion: 'ignorar' }).success).toBe(false)
    expect(respuestaIaSchema.safeParse({ ...respuesta, extra: true }).success).toBe(false)
    expect(respuestaIaSchema.safeParse({ ...respuesta, cache: undefined }).success).toBe(false)
  })
})

describe('contratos T-038 sin datos personales', () => {
  const coincidencia = {
    accion: 'duplicado',
    coincidencia_id: 'A'.repeat(43),
    codigo: 'INC-2026-INF-0001',
    categoria: 'infraestructura',
    reportado_hace_minutos: 10,
    adhesiones: 0,
  }

  it('acepta solo la respuesta publica de coincidencia', () => {
    expect(posibleDuplicadoSchema.safeParse(coincidencia).success).toBe(true)
    expect(posibleDuplicadoSchema.safeParse({ ...coincidencia, reportante: 'Ana' }).success).toBe(false)
    expect(confirmarAdhesionSchema.safeParse({ coincidencia_id: 'A'.repeat(43) }).success).toBe(true)
    expect(confirmarAdhesionSchema.safeParse({ coincidencia_id: 'corta' }).success).toBe(false)
  })

  it('valida la respuesta idempotente de adhesion', () => {
    const adhesion = { ok: true, codigo: coincidencia.codigo, categoria: coincidencia.categoria, adhesiones: 1, registrada: true }
    expect(adhesionSchema.safeParse(adhesion).success).toBe(true)
    expect(adhesionSchema.safeParse({ ...adhesion, usuario_id: 'interno' }).success).toBe(false)
  })
})

describe('ia_sugerencia (IASugerencia, extra=forbid, sin null)', () => {
  const ok = { modo: 'asistido', modelo: 'claude-opus-5-5', version_prompt: 'v1', confianza: 0.9, campos_autollenados: ['titulo'] }
  it('acepta el contrato de backend y rechaza null, extras y duplicados', () => {
    expect(iaSugerenciaSchema.safeParse(ok).success).toBe(true)
    expect(iaSugerenciaSchema.safeParse({ ...ok, accion: 'sugerir', campos_editados_por_usuario: ['detalle_especifico.ip'] }).success).toBe(true)
    expect(iaSugerenciaSchema.safeParse({ ...ok, accion: null }).success).toBe(false)
    expect(iaSugerenciaSchema.safeParse({ ...ok, correo: 'x@utm.edu.mx' }).success).toBe(false)
    expect(iaSugerenciaSchema.safeParse({ ...ok, campos_autollenados: ['titulo', 'titulo'] }).success).toBe(false)
    expect(iaSugerenciaSchema.safeParse({ ...ok, confianza: 1.2 }).success).toBe(false)
  })
})
