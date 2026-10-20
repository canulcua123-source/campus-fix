import { useRegisterSW } from 'virtual:pwa-register/react'

export function UpdatePrompt() {
  const {
    needRefresh: [necesitaActualizar, setNecesitaActualizar],
    updateServiceWorker,
  } = useRegisterSW()
  if (!necesitaActualizar) return null
  return (
    <div role="alert" className="card fixed inset-x-4 z-50 flex items-center justify-between gap-3" style={{ bottom: 'calc(90px + var(--safe-bottom))' }}>
      <span className="text-sm">Hay una nueva versión disponible.</span>
      <span className="flex gap-2">
        <button className="btn btn-secundario" onClick={() => setNecesitaActualizar(false)}>Luego</button>
        <button className="btn" onClick={() => updateServiceWorker(true)}>Actualizar</button>
      </span>
    </div>
  )
}
