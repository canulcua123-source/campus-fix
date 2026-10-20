import { useEffect, useState } from 'react'
import { esSafariIOS, isStandalone } from '../lib/platform'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function InstallPrompt() {
  const [evento, setEvento] = useState<BeforeInstallPromptEvent | null>(null)
  const [cerrado, setCerrado] = useState(false)

  useEffect(() => {
    const alEvento = (e: Event) => {
      e.preventDefault()
      setEvento(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', alEvento)
    return () => window.removeEventListener('beforeinstallprompt', alEvento)
  }, [])

  if (cerrado || isStandalone()) return null
  const mostrarIOS = esSafariIOS()
  if (!evento && !mostrarIOS) return null

  return (
    <div className="card mb-4 flex items-center justify-between gap-3">
      <p className="m-0 text-sm">
        {evento ? 'Instala UTM Desk en tu dispositivo para abrirla como una app.' : 'Para instalar: toca Compartir → Agregar a inicio.'}
      </p>
      <span className="flex gap-2">
        <button className="btn btn-secundario" onClick={() => setCerrado(true)}>Ahora no</button>
        {evento && (
          <button
            className="btn"
            onClick={async () => {
              await evento.prompt()
              setEvento(null)
            }}
          >
            Instalar
          </button>
        )}
      </span>
    </div>
  )
}
