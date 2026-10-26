import type { ReactNode } from 'react'
import { useAuth } from '../auth/store'
import { Card, PageHeader } from '../components/ui'

function Apartado({ id, titulo, children }: { id: string; titulo: string; children: ReactNode }) {
  return (
    <Card como="section" className="mt-3" aria-labelledby={id}>
      <h2 id={id} className="mb-2 mt-0 text-base font-semibold text-ink">{titulo}</h2>
      <div className="text-ink [&_p]:my-2 [&_ul]:my-2 [&_ul]:pl-5">{children}</div>
    </Card>
  )
}

/**
 * T-058: aviso de privacidad simplificado. Público: se abre sin iniciar sesión (ruta fuera de RequirePermiso),
 * por eso no pide datos a la API.
 */
export default function Privacidad() {
  const conSesion = useAuth((s) => Boolean(s.token))
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-10" style={{ paddingTop: 'calc(16px + var(--safe-top))' }}>
      <PageHeader
        titulo="Aviso de privacidad"
        subtitulo="UTM Desk · versión simplificada"
        atras={conSesion ? { to: '/perfil', texto: 'Perfil' } : { to: '/login', texto: 'Iniciar sesión' }}
      />

      <Apartado id="priv-responsable" titulo="Quién trata tus datos">
        <p>La universidad, a través del área responsable de UTM Desk, trata tus datos solo para atender los reportes de incidencias del campus.</p>
      </Apartado>

      <Apartado id="priv-datos" titulo="Qué datos usamos">
        <ul>
          <li>Tu nombre, correo institucional y rol dentro de la plataforma.</li>
          <li>Lo que escribes en cada reporte: título, descripción, ubicación y datos técnicos.</li>
          <li>Las fotos y documentos que adjuntas como evidencia.</li>
          <li>El historial de seguimiento: cambios de estado, comentarios y técnico asignado.</li>
        </ul>
      </Apartado>

      <Apartado id="priv-finalidad" titulo="Para qué los usamos">
        <ul>
          <li>Registrar, asignar y resolver las incidencias que reportas.</li>
          <li>Avisarte del avance de tus reportes.</li>
          <li>Generar estadísticas del campus sin identificar a las personas.</li>
        </ul>
      </Apartado>

      <Apartado id="priv-ia" titulo="Análisis con inteligencia artificial">
        <p>Si lo usas, la foto de la incidencia se envía a un servicio de inteligencia artificial para sugerir los campos del reporte. Las sugerencias siempre puedes editarlas y nunca se envía un reporte sin tu confirmación.</p>
      </Apartado>

      <Apartado id="priv-seguridad" titulo="Cómo los protegemos">
        <p>Solo las personas con el rol y el permiso necesarios ven cada reporte. Las evidencias se guardan en un almacenamiento privado y se abren con enlaces temporales. Tu sesión no se guarda en el navegador.</p>
      </Apartado>

      <Apartado id="priv-derechos" titulo="Tus derechos">
        <p>Puedes pedir acceso, corrección o cancelación de tus datos, u oponerte a su uso, con el área responsable de UTM Desk en tu universidad.</p>
      </Apartado>
    </main>
  )
}
