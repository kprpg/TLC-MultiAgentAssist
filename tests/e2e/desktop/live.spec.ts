import { expect, test, _electron as electron } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

test('retrieves live MSX data and completes a Foundry-backed MCEM run', async () => {
  test.skip(process.env['TLC_RUN_LIVE_SMOKE'] !== '1', 'Run with npm run test:smoke:live.')
  test.skip(!existsSync(resolve('config/foundry.environment.json')), 'Private Foundry environment is not configured.')
  test.setTimeout(180_000)

  const app = await electron.launch({
    args: [resolve('apps/desktop')],
    env: { ...process.env, TLC_DATA_MODE: 'live' }
  })

  try {
    const window = await app.firstWindow()
    await expect(window.getByText('LIVE MSX', { exact: true })).toBeVisible({ timeout: 60_000 })
    await expect(window.getByText('NEXT BEST ACTIONS')).toBeVisible({ timeout: 120_000 })
    await expect(window.locator('[role="alert"]')).toHaveCount(0)
  } finally {
    await app.close()
  }
})