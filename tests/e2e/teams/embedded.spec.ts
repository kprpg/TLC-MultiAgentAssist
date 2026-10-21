import { expect, test } from '@playwright/test'
import { embeddedTeams } from './helpers.js'

test('the mode-discard confirmation is usable inside a sandboxed Teams iframe without contacting Live before confirmation', async ({ page }) => {
  let liveRequests = 0
  await page.route('**/api/teams/modes', (route) => route.fulfill({
    json: { contractVersion: '1.0', initialMode: 'sample', runtimeMode: 'sample', runtimeAuthentication: 'hosted-obo', availableModes: ['sample', 'live'] }
  }))
  await page.route('**/api/teams/live/**', (route) => { liveRequests++; return route.abort() })
  const app = await embeddedTeams(page, 'content', 'default', '1.2484.12345', true)
  await app.getByLabel('Data mode', { exact: true }).selectOption('live')
  const dialog = app.getByRole('dialog', { name: 'Switch to Live mode?', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText("This clears this page's unsaved drafts, displayed results and pending reviews. Other open pages are unchanged.", { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Keep current mode', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(app.getByLabel('Data mode', { exact: true })).toHaveValue('sample')
  expect(liveRequests).toBe(0)
})

test('real Teams SDK handshake retains theme changes and keyboard navigation in the embedded UI', async ({ page }) => {
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(error.message))
  const app = await embeddedTeams(page, 'content')
  await expect(app.getByRole('button', { name: 'Portfolio', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(app.locator('#portfolio-details-panel')).toBeVisible()
  const background = () => app.locator('.teams-shell').evaluate((element) => getComputedStyle(element).backgroundColor)
  const light = await background()
  for (const theme of ['dark', 'contrast', 'default']) {
    await page.evaluate((value) => {
      document.querySelector('iframe')?.contentWindow?.postMessage({ func: 'themeChange', args: [value] }, 'http://127.0.0.1:4188')
    }, theme)
    if (theme === 'default') await expect.poll(background).toBe(light)
    else await expect.poll(background).not.toBe(light)
    await expect(app.getByRole('button', { name: 'Portfolio', exact: true })).toBeVisible()
  }
  const overview = app.getByRole('tab', { name: 'Overview', exact: true })
  await overview.focus()
  await overview.press('ArrowRight')
  await expect(app.getByRole('tab', { name: 'Guidance', exact: true })).toBeFocused()
  await expect(app.getByRole('textbox', { name: 'Ask TLC', exact: true })).toBeVisible()
  expect(failures).toEqual([])
})

test('SDK settings and side-panel frames use their own safe compact surfaces', async ({ page }) => {
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(error.message))
  const settings = await embeddedTeams(page, 'settings')
  await expect(settings.getByRole('heading', { name: 'Configure a Teams context' })).toBeVisible()
  await page.unroute('https://teams.microsoft.com/tlc-ui-test')
  await page.setViewportSize({ width: 360, height: 800 })
  const panel = await embeddedTeams(page, 'sidePanel', 'dark')
  await expect(panel.getByRole('tablist', { name: 'Meeting tasks' })).toBeVisible()
  await expect(panel.getByRole('tab', { name: 'Prep', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(panel.getByRole('button', { name: 'Plays', exact: true })).toBeHidden()
  await expect(panel.getByRole('heading', { name: 'Meeting preparation', exact: true })).toBeVisible()
  expect(failures).toEqual([])
})
