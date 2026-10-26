// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { RespuestaIA } from '../schemas/ia'
import { SugerenciaIA } from './SugerenciaIA'

afterEach(cleanup)

const analisis: RespuestaIA['analisis'] = {
  es_incidencia_valida: true,
  categoria: 'infraestructura',
  titulo: 'Luminaria fundida',
  descripcion: 'Se observa una luminaria apagada',
  prioridad_sugerida: 'baja',
  tags: ['luminaria'],
  campos_detectados: [],
  confianza: 0.9,
  advertencias: [],
}

describe('SugerenciaIA', () => {
  it.each([
    ['autollenar', 'Formulario completado por IA'],
    ['sugerir', 'Sugerencia de IA'],
    ['preguntar', 'Necesitamos tu ayuda'],
    ['rechazar', 'Foto no reconocida'],
  ] as const)('mensaje por accion: %s', (accion, etiqueta) => {
    const mensaje = `Mensaje para ${accion}`
    render(<SugerenciaIA respuesta={{ accion, mensaje, analisis, cache: false }} />)

    expect(screen.getByRole('status', { name: etiqueta }).textContent).toContain(mensaje)
  })
})
