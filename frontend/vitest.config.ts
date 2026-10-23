import { defineConfig } from 'vitest/config'

// Config propia de pruebas: no carga los plugins de PWA/Tailwind de vite.config.ts.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    restoreMocks: true,
    unstubGlobals: true,
    css: true,
  },
})
