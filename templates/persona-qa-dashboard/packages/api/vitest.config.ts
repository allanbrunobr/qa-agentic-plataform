import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // src/routes/__tests__ holds node:test suites run via `node --import tsx --test`.
    exclude: ['**/node_modules/**', '**/dist/**', 'src/routes/__tests__/**'],
  },
})
