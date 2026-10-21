import { defineConfig } from 'vitest/config'

// Config propia de pruebas: no carga los plugins de PWA/Tailwind de vite.config.ts.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
    unstubGlobals: true,
  },
})
