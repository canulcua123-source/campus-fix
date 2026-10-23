import { setupServer } from 'msw/node'
import { handlers } from './handlers'

export const servidor = setupServer(...handlers)
