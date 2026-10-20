import { expect, type APIRequestContext, type Page } from '@playwright/test'

export async function embeddedTeams(page: Page, frameContext: 'content' | 'settings' | 'sidePanel', theme = 'default', packageVersion = '1.2484.12345', sandboxed = false) {
  const url = `http://127.0.0.1:4188/?tlcAppVersion=${encodeURIComponent(packageVersion)}`
  await page.context().grantPermissions(['local-network-access'], { origin: 'https://teams.microsoft.com' })
  await page.route('https://teams.microsoft.com/tlc-ui-test', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><head><title>Sanitized Teams host fixture</title></head>
      <body style="margin:0"><iframe title="TLC fixture" src="${url}" ${sandboxed ? 'sandbox="allow-scripts allow-same-origin"' : ''} style="border:0;width:100%;height:100vh"></iframe>
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

export async function post(request: APIRequestContext, operation: string, input: unknown) {
  const response = await request.post(`/api/teams/operations/${operation}`, { data: input })
  expect(response.ok()).toBeTruthy()
  return response.json()
}
export async function openUtility(page: Page, name: string) {
  await page.getByText('Tools', { exact: true }).click()
  await page.getByRole('button', { name, exact: true }).click()
}
export async function chooseOpportunity(page: Page, request: APIRequestContext, transcriptRequired = false) {
  const accounts: Array<{ id: string; name: string }> = await post(request, 'listAccounts', {})
  for (const account of accounts) {
    const opportunities: Array<{ id: string; name: string }> = await post(request, 'listOpportunities', { accountId: account.id })
    for (const opportunity of opportunities) {
      const sources = transcriptRequired
        ? await (await request.post('/api/teams/meetings/sources', { data: { opportunityId: opportunity.id } })).json() as unknown[] : [true]
      if (!sources.length) continue
      await page.getByRole('button', { name: 'Portfolio', exact: true }).click()
      await page.getByLabel('Customer account', { exact: true }).selectOption(account.id)
      await page.getByLabel('Opportunity', { exact: true }).selectOption(opportunity.id)
      await expect(page.getByRole('heading', { name: opportunity.name, exact: true })).toBeVisible()
      return { account, opportunity }
    }
  }
  throw new Error('The canonical sample dataset has no eligible opportunity.')
}
