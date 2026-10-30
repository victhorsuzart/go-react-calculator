import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // Test files and test helpers (src/test/) are not measured (SPEC §9.5).
      exclude: [
        'src/main.tsx',
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        'src/**/*.css',
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
        'src/calculator/**': {
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 90,
        },
        'src/api/**': {
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 90,
        },
      },
    },
  },
})
