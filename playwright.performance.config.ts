import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e/backend-performance',
  globalSetup: './tests/fixtures/performance/build.ts',
  outputDir: './test-results/backend-performance-runs',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  use: { trace: 'retain-on-failure' }
})
