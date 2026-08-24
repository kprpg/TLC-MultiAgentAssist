import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.{test,spec}.ts'],
    exclude: ['tests/e2e/**'],
    coverage: {
      reporter: ['text', 'html']
    }
  }
})