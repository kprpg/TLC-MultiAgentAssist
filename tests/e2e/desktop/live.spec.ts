import { expect, test, _electron as electron } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

test('retrieves live MSX data and completes all four Foundry-backed UI tasks', async () => {
  test.skip(process.env['TLC_RUN_LIVE_SMOKE'] !== '1', 'Run with npm run test:smoke:live.')
  test.skip(!existsSync(resolve('config/foundry.environment.json')), 'Private Foundry environment is not configured.')
  test.setTimeout(360_000)

  const app = await electron.launch({
    args: [resolve('apps/desktop')],
    env: { ...process.env, TLC_DATA_MODE: 'live' }
  })

  try {
    const window = await app.firstWindow()
    await expect(window.getByText('LIVE MSX', { exact: true })).toBeVisible({ timeout: 60_000 })
    await expect.poll(async () => {
      const alert = window.locator('[role="alert"]')
      if (await alert.count() > 0) return `error: ${await alert.first().innerText()}`
      return await window.getByRole('tab', { name: 'Foundry Agent', exact: true }).isVisible() ? 'ready' : 'loading'
    }, { timeout: 120_000 }).toBe('ready')
    await window.getByRole('tab', { name: 'Foundry Agent', exact: true }).click()
    await expect(window.getByRole('button', { name: 'Run Account Pulse' })).toBeInViewport()
    for (const task of ['Account Pulse', 'MCEM Coach', 'Pursuit & Executive', 'Risk & Solution Play']) {
      await window.getByRole('tab', { name: task }).click()
      await window.getByRole('button', { name: `Run ${task}` }).click()
      const synthesis = window.locator('.agent-synthesis')
      await expect(synthesis).toBeVisible({ timeout: 90_000 })
      await expect(synthesis.locator('.agent-synthesis-content')).not.toBeEmpty()
      await expect(synthesis.getByText('Agent active · MSX + MCEM', { exact: true })).toBeVisible()
    }
    await expect(window.locator('[role="alert"]')).toHaveCount(0)
  } finally {
    await app.close()
  }
})