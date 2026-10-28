import { expect, test } from '@playwright/test'
import { chooseOpportunity } from './helpers.js'
import { expectWorkingSessionIcon } from '../working-session-icon.js'

test('the Teams target icon opens the existing working-session preparation and download flow', async ({ page, request }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  let preparations = 0
  page.on('request', (entry) => {
    if (entry.method() === 'POST' && entry.url().includes('/api/teams/working-session/')) preparations++
  })
  await page.goto('/')
  await chooseOpportunity(page, request)
  await page.getByRole('tab', { name: 'Overview', exact: true }).click()
  const launcher = page.getByRole('button', { name: 'Generate Prep/ Delivery Artifacts' })
  await expectWorkingSessionIcon(launcher)
  await launcher.focus()
  await launcher.press('Enter')
  const panel = page.getByRole('dialog', { name: 'Prepare working session' })
  await expect(panel).toBeVisible()
  await expect(launcher).toHaveAttribute('aria-expanded', 'true')
  expect(preparations).toBe(0)
  await panel.getByRole('button', { name: 'Suggest topic' }).click()
  await expect(panel.getByRole('textbox', { name: 'Topic' })).not.toHaveValue('')
  await panel.getByRole('checkbox', { name: /PowerPoint decks/ }).uncheck()
  await panel.getByRole('button', { name: 'Prepare', exact: true }).click()
  await expect(panel.getByRole('status').first()).toContainText(/Prepared \d+ file/)
  const [download] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'Download zip' }).click()])
  expect(download.suggestedFilename()).toMatch(/\.zip$/)
  expect(preparations).toBe(2)
})
