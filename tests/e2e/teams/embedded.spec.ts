import { expect, test, type Page } from '@playwright/test'

async function embedded(page: Page, frameContext: 'content' | 'settings' | 'sidePanel', theme = 'default') {
  const url = 'http://127.0.0.1:4188/'
  await page.context().grantPermissions(['local-network-access'], { origin: 'https://teams.microsoft.com' })
  await page.route('https://teams.microsoft.com/tlc-ui-test', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><head><title>Sanitized Teams host fixture</title></head>
      <body style="margin:0"><iframe title="TLC fixture" src="${url}" style="border:0;width:100%;height:100vh"></iframe>
      <script>
        const appOrigin = ${JSON.stringify(new URL(url).origin)};
        window.addEventListener('message', (event) => {
          if (event.origin !== appOrigin) return;
          const message = event.data;
          if (!message || typeof message !== 'object') return;
          let args;
          if (message.func === 'initialize') args = [
            ${JSON.stringify(frameContext)}, 'web',
            JSON.stringify({ apiVersion: 4, supports: { pages: { config: {} } }, isNAAChannelRecommended: false }),
            '2.58.0'
          ];
          if (message.func === 'getContext') args = [{
            locale: 'en-us', theme: ${JSON.stringify(theme)}, frameContext: ${JSON.stringify(frameContext)},
            hostClientType: 'web', hostName: 'teams', entityId: 'sanitized-tab',
            appSessionId: '11111111-1111-4111-8111-111111111111'
          }];
          if (args) event.source.postMessage({ id: message.id, uuid: message.uuid, args }, appOrigin);
        });
      </script></body></html>`
  }))
  await page.goto('https://teams.microsoft.com/tlc-ui-test')
  return page.frameLocator('iframe')
}

test('real Teams SDK handshake retains theme changes and keyboard navigation in the embedded UI', async ({ page }) => {
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(error.message))
  const app = await embedded(page, 'content')
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
  const settings = await embedded(page, 'settings')
  await expect(settings.getByRole('heading', { name: 'Configure a Teams context' })).toBeVisible()
  await page.unroute('https://teams.microsoft.com/tlc-ui-test')
  await page.setViewportSize({ width: 360, height: 800 })
  const panel = await embedded(page, 'sidePanel', 'dark')
  await expect(panel.getByRole('tablist', { name: 'Meeting tasks' })).toBeVisible()
  await expect(panel.getByRole('tab', { name: 'Prep', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(panel.getByRole('button', { name: 'Plays', exact: true })).toBeHidden()
  await expect(panel.getByRole('heading', { name: 'Meeting preparation', exact: true })).toBeVisible()
  expect(failures).toEqual([])
})
