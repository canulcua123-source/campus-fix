import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { restaurarSesion } from './api/auth'
import { crearQueryClient } from './api/queryClient'
import App from './App'
import './index.css'
import { aplicarPlataforma } from './lib/platform'

aplicarPlataforma()
const queryClient = crearQueryClient()
// Refresh silencioso con la cookie HttpOnly antes del primer render: recargar no cierra la sesión.
void restaurarSesion()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
