import { defineConfig } from '@playwright/test'

if (process.env['TLC_RUN_LIVE_SMOKE'] !== '1') process.env['TLC_AI_MODE'] = 'sample'

export default defineConfig({
  testDir: './tests/e2e/revamp',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js preview --config apps/desktop/vite.revamp.config.ts --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: true
  }
})