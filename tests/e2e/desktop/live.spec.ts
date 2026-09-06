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
    await expect(window.getByText('Live MSX', { exact: true }).first()).toBeVisible({ timeout: 60_000 })
    await window.getByRole('region', { name: 'Accounts blade' }).getByRole('button')
      .filter({ hasText: 'Live MSX' }).first().click()
    const opportunitiesBlade = window.getByRole('region', { name: 'Opportunities blade' })
    await expect(opportunitiesBlade).toBeVisible({ timeout: 60_000 })
    await opportunitiesBlade.locator('.opportunity-button').first().click()
    await expect.poll(async () => {
      const alert = window.locator('[role="alert"]')
      if (await alert.count() > 0) return `error: ${await alert.first().innerText()}`
      return await window.getByRole('tab', { name: 'Multi-Agent Guidance', exact: true }).isVisible() ? 'ready' : 'loading'
    }, { timeout: 120_000 }).toBe('ready')
    await window.getByRole('tab', { name: 'Multi-Agent Guidance', exact: true }).click()
    const tasks = [
      ['Account Pulse', 'What should the account team focus on this week?'],
      ['MCEM Coach', 'How do we move this opportunity to the next MCEM stage?'],
      ['Pursuit', 'Create an executive-ready brief for this opportunity.'],
      ['Risk & Play', 'Identify the highest grounded risks and mitigation actions.']
    ] as const
    for (const [task, prompt] of tasks) {
      await window.getByRole('tab', { name: task }).click()
      await window.getByRole('button', { name: prompt }).click()
      const response = window.locator('.agent-response')
      await expect(response.locator('.eyebrow')).toHaveText(task, { timeout: 90_000 })
      await expect(response).not.toBeEmpty()
    }
    await expect(window.locator('.error-state')).toHaveCount(0)
  } finally {
    await app.close()
  }
})