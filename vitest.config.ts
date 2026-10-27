import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    env: process.env['TLC_RUN_LIVE_SMOKE'] === '1' ? {} : { TLC_AI_MODE: 'sample' },
    include: ['tests/**/*.{test,spec}.ts'],
    exclude: ['tests/e2e/**'],
    coverage: {
      reporter: ['text', 'html', 'json', 'lcov']
    }
  }
})