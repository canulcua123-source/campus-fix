import { defineConfig } from 'vitest/config'

// Config propia de pruebas: no carga los plugins de PWA/Tailwind de vite.config.ts.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    unstubGlobals: true,
    // tokens.test.ts lee tokens.css con ?raw para medir contraste.
    css: { include: [/tokens\.css/] },
  },
})
