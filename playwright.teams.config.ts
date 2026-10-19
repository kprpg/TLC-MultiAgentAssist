import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e/teams',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4188', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run teams:build && node --experimental-sqlite apps/teams/dist/server.js',
    url: 'http://127.0.0.1:4188/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      TLC_TEAMS_MODE: 'sample', TLC_TEAMS_PORT: '4188',
      TLC_TEAMS_ORIGIN: 'http://127.0.0.1:4188',
      TLC_TEAMS_STATE_PATH: ':memory:', TLC_TEAMS_SAMPLE_PATH: ':memory:'
    }
  }
})
