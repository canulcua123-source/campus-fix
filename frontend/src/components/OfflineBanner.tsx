import { useSyncExternalStore } from 'react'

function suscribir(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

export function OfflineBanner() {
  const enLinea = useSyncExternalStore(suscribir, () => navigator.onLine)
  if (enLinea) return null
  return (
    <div role="status" className="bg-warn px-4 py-2 text-center text-sm font-semibold text-on-warn" style={{ paddingTop: 'calc(8px + var(--safe-top))' }}>
      Sin conexión. Algunas funciones no estarán disponibles.
    </div>
  )
}
