import { expect, test, type Page } from '@playwright/test'
import { getCliCapabilities, cliPublicConfigurationVersion, localConnectionVersion, localPairRequestSchema, nativeCapabilities, localSessionLeaseMs, localWorkSessionMs, type CliWriteMode } from '../../../packages/common/contracts/local-connection.js'
import { chooseOpportunity, embeddedTeams, post } from './helpers.js'
import { teamsClientReadyRequestSchema } from '../../../packages/common/contracts/teams-launch.js'
import { meetingChangeSetResultSchema } from '../../../packages/common/contracts/meeting.js'
import { actionPreviewSchema, actionReceiptSchema } from '../../../packages/common/contracts/collaboration.js'

async function offlineNativeFixture(page: Page, cli = false, writeMode: CliWriteMode = 'read-only', initialMode: 'sample' | 'live' = 'live') {
  const launch = await (await page.request.get('/api/teams/launch')).json()
  let approved = false
  let revoked = false
  let unavailable = false
  let mcpConnected = false
  let privateRequests = 0
  const token = 'L'.repeat(43)
  const expiresAt = new Date(Date.now() + 300_000).toISOString()
  const sessionExpiresAt = Date.now() + localWorkSessionMs
  const requests: string[] = []
  const reports: unknown[] = []
  await page.route('**/api/teams/**', async (route) => {
    const path = new URL(route.request().url()).pathname.slice('/api/teams/'.length)
    requests.push(path)
    const json = (value: unknown, status = 200) => route.fulfill({ status, json: value })
    if (path === 'modes') return json({
      contractVersion: '1.0', initialMode, runtimeMode: 'live',
      runtimeAuthentication: cli ? 'local-azure-cli' : 'local-interactive', availableModes: ['sample', 'live']
    })
    if (path.startsWith('sample/')) return route.continue()
    if (path === 'launch') return json({ ...launch, mode: 'live', authentication: cli ? 'local-azure-cli' : 'local-interactive' })
    if (path === 'config') return json({
      contractVersion: cli ? cliPublicConfigurationVersion : localConnectionVersion, mode: 'live',
      authentication: cli ? 'local-azure-cli' : 'local-interactive',
      ...(cli ? { writeMode } : {}), capabilities: cli ? getCliCapabilities(writeMode) : nativeCapabilities
    })
    if (path === 'local/requests') {
      localPairRequestSchema.parse(route.request().postDataJSON())
      return json({ contractVersion: localConnectionVersion, requestId: '55555555-5555-4555-8555-555555555555', userCode: 'A1B2C3D4', expiresAt, state: 'pending-owner-approval' }, 201)
    }
    if (path === 'local/exchange') return json(approved
      ? { contractVersion: localConnectionVersion, state: 'paired', token, expiresAt }
      : { contractVersion: localConnectionVersion, state: 'pending-owner-approval', expiresAt })
    privateRequests++
    if (revoked || unavailable || route.request().headers()['authorization'] !== `Bearer ${token}`) return json({ error: 'authorization_required' }, 401)
    if (path === 'local/renew') {
      const now = await page.evaluate(() => Date.now())
      return json({ contractVersion: '1.0', expiresAt: new Date(Math.min(now + localSessionLeaseMs, sessionExpiresAt)).toISOString(), sessionExpiresAt: new Date(sessionExpiresAt).toISOString() })
    }
    if (path === 'session') return json({ contractVersion: '1.0', mode: 'live', roles: cli ? [] : ['TLC.Teams.User'], displayName: cli ? `Verified local MSX user (${writeMode === 'reviewed' ? 'reviewed read/write' : 'read-only'})` : 'Offline native fixture' })
    if (path === 'local/status') return json({
      contractVersion: localConnectionVersion, state: 'connected', detail: 'Offline fixture only. No actual source data was accessed.',
      account: 'offline-owner@example.test',
      resources: [{ resource: 'mcp', state: mcpConnected ? 'connected' : 'not-connected', detail: 'Offline optional source fixture.' }],
      capabilities: cli ? getCliCapabilities(writeMode) : nativeCapabilities
    })
    if (path === 'launch/ready') {
      reports.push(teamsClientReadyRequestSchema.parse(route.request().postDataJSON()))
      return json({ contractVersion: '1.0', state: 'ready' })
    }
    if (path === 'local/revoke') { revoked = true; return json({ contractVersion: localConnectionVersion, state: 'disconnected' }) }
    if (cli && writeMode === 'reviewed' && /^(operations|actions)\//.test(path)) return route.continue()
    if (path === 'operations/getPortfolioWorkspace' || path === 'operations/getPortfolioIndex') return json({
      contractVersion: '1.0',
      accounts: cli ? [{ id: 'cli-own-account', name: 'Offline signed-in user deal-team account', segment: 'Live MSX', provenance: 'deal-team', visibility: 'visible' }] : [],
      opportunities: [],
      ...(path.endsWith('getPortfolioWorkspace') ? { milestones: [], ...(cli ? { selectedAccountId: 'cli-own-account' } : {}) } : {})
    })
    if (path === 'operations/listAccounts') return json(cli ? [{
      id: 'cli-own-account', name: 'Offline signed-in user deal-team account', segment: 'Live MSX', provenance: 'deal-team', visibility: 'visible'
    }] : [])
    if (path === 'operations/listOpportunities') return json([])
    if (path === 'operations/workflows.list') return json([])
    return json({ error: 'offline_fixture_operation_not_configured' }, 409)
  })
  return { approve: () => { approved = true }, connectMcp: () => { mcpConnected = true }, invalidate: () => { unavailable = true }, requests, reports, privateRequests: () => privateRequests, token }
}
test('Sample can open before Live pairing and mode confirmation preserves or discards drafts explicitly', async ({ page, request }) => {
  const fixture = await offlineNativeFixture(page, true, 'read-only', 'sample')
  await page.goto('/')
  await expect(page.getByText('Sample - no live business data', { exact: true })).toBeVisible()
  expect(fixture.privateRequests()).toBe(0)
  const { account, opportunity } = await chooseOpportunity(page, request)
  await page.getByText('Opportunity notes and reviewed updates', { exact: true }).click()
  const original = await page.getByLabel('Opportunity notes', { exact: true }).inputValue()
  await page.getByLabel('Opportunity notes', { exact: true }).fill('Unsaved sample-only draft')
  await page.getByLabel('Data mode', { exact: true }).selectOption('live')
  const dialog = page.getByRole('dialog', { name: 'Switch to Live mode?', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Keep current mode', exact: true }).click()
  await expect(page.getByLabel('Opportunity notes', { exact: true })).toHaveValue('Unsaved sample-only draft')
  expect(fixture.privateRequests()).toBe(0)
  await page.getByLabel('Data mode', { exact: true }).selectOption('live')
  await dialog.getByRole('button', { name: 'Switch mode and discard unsaved work', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Request local pairing', exact: true })).toBeVisible()
  expect(fixture.privateRequests()).toBe(0)
  await page.getByLabel('Data mode', { exact: true }).selectOption('sample')
  await page.getByRole('dialog', { name: 'Switch to Sample mode?', exact: true })
    .getByRole('button', { name: 'Switch mode and discard unsaved work', exact: true }).click()
  await page.getByLabel('Customer account', { exact: true }).selectOption(account.id)
  await page.getByLabel('Opportunity', { exact: true }).selectOption(opportunity.id)
  await page.getByText('Opportunity notes and reviewed updates', { exact: true }).click()
  await expect(page.getByLabel('Opportunity notes', { exact: true })).toHaveValue(original)
  expect(fixture.requests.filter((path) => path === 'local/requests')).toHaveLength(0)
})
test('one paired page switches to persistent SQLite Sample and back to Live without another pairing or Live calls from Sample', async ({ page, request }) => {
  const fixture = await offlineNativeFixture(page, true)
  await page.goto('/')
  await page.getByRole('button', { name: 'Request local pairing', exact: true }).click()
  fixture.approve()
  await expect(page.getByLabel('Customer account', { exact: true })).toHaveValue('cli-own-account')
  await page.getByLabel('Data mode', { exact: true }).selectOption('sample')
  await page.getByRole('dialog', { name: 'Switch to Sample mode?', exact: true })
    .getByRole('button', { name: 'Switch mode and discard unsaved work', exact: true }).click()
  await expect(page.getByText('Sample - no live business data', { exact: true })).toBeVisible()
  const privateBefore = fixture.privateRequests()
  const { account, opportunity } = await chooseOpportunity(page, request)
  await page.getByText('Opportunity notes and reviewed updates', { exact: true }).click()
  const original = await page.getByLabel('Opportunity notes', { exact: true }).inputValue()
  await page.getByLabel('Opportunity notes', { exact: true }).fill('Persisted isolated Sample mode edit')
  await page.getByRole('button', { name: 'Review opportunity update', exact: true }).click()
  const review = page.getByRole('dialog', { name: 'Review exact changes', exact: true })
  await review.getByLabel('Review reason', { exact: true }).fill('Reviewed only the local Sample edit')
  let release = () => {}
  const blocked = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/api/teams/sample/actions/commit', async (route) => { await blocked; await route.continue() })
  await review.getByRole('button', { name: 'Confirm selected changes', exact: true }).click()
  await expect(page.locator('.data-mode-switcher select')).toBeDisabled()
  release()
  await expect(review).toBeHidden()
  await expect(page.getByLabel('Data mode', { exact: true })).toBeEnabled()
  expect(fixture.privateRequests()).toBe(privateBefore)
  await page.getByLabel('Data mode', { exact: true }).selectOption('live')
  await page.getByRole('dialog', { name: 'Switch to Live mode?', exact: true })
    .getByRole('button', { name: 'Switch mode and discard unsaved work', exact: true }).click()
  await expect(page.getByLabel('Customer account', { exact: true })).toHaveValue('cli-own-account')
  expect(fixture.requests.filter((path) => path === 'local/requests')).toHaveLength(1)
  await page.getByLabel('Data mode', { exact: true }).selectOption('sample')
  await page.getByRole('dialog', { name: 'Switch to Sample mode?', exact: true })
    .getByRole('button', { name: 'Switch mode and discard unsaved work', exact: true }).click()
  await page.getByLabel('Customer account', { exact: true }).selectOption(account.id)
  await page.getByLabel('Opportunity', { exact: true }).selectOption(opportunity.id)
  await page.getByText('Opportunity notes and reviewed updates', { exact: true }).click()
  await expect(page.getByLabel('Opportunity notes', { exact: true })).toHaveValue('Persisted isolated Sample mode edit')
  fixture.invalidate()
  await page.getByLabel('Data mode', { exact: true }).selectOption('live')
  await page.getByRole('dialog', { name: 'Switch to Live mode?', exact: true })
    .getByRole('button', { name: 'Switch mode and discard unsaved work', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Request local pairing', exact: true })).toBeVisible()
  await expect(page.getByLabel('Customer account', { exact: true })).toBeHidden()
  await expect(page.getByText('Offline signed-in user deal-team account', { exact: true })).toBeHidden()
  const restored = actionPreviewSchema.parse(await (await request.post('/api/teams/actions/preview', {
    data: { operation: 'updateOpportunity', input: { opportunityId: opportunity.id, update: { comments: original } } }
  })).json())
  expect(actionReceiptSchema.parse(await (await request.post('/api/teams/actions/commit', {
    data: { contractVersion: '1.0', id: restored.id, digest: restored.digest, reason: 'Restore prior sanitized Sample notes after the browser regression.' }
  })).json()).state).toBe('confirmed')
})
test('live Plays explains optional MCP setup, waits for owner connection and preserves the MSX page', async ({ page }) => {
  const fixture = await offlineNativeFixture(page, true, 'reviewed')
  await page.goto('/')
  await page.getByRole('button', { name: 'Request local pairing' }).click()
  fixture.approve()
  await expect(page.getByRole('button', { name: 'Plays', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Plays', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Connect MCP to run live Plays', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run workflow', exact: true })).toBeDisabled()
  expect(fixture.requests).not.toContain('operations/workflows.start')
  expect(fixture.requests.some((path) => path.includes('/connect'))).toBe(false)
  fixture.connectMcp()
  await page.getByRole('button', { name: 'Check MCP connection', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Run workflow', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Run workflow', exact: true }).click()
  await expect(page.getByTestId('workflow-status')).toContainText('completed')
  await expect(page.getByRole('button', { name: 'Request local pairing' })).toHaveCount(0)
})
test('a paired live page renews past fifteen minutes but clears its private workspace at the eight-hour workday limit', async ({ page }) => {
  await page.clock.install({ time: new Date() })
  const fixture = await offlineNativeFixture(page, true)
  await page.goto('/')
  await page.getByRole('button', { name: 'Request local pairing' }).click()
  fixture.approve()
  await expect(page.getByLabel('Customer account', { exact: true })).toHaveValue('cli-own-account')
  const checksBefore = fixture.requests.filter((path) => path === 'local/status').length
  await page.clock.fastForward(16 * 60_000)
  await expect.poll(() => fixture.requests.filter((path) => path === 'local/renew').length).toBeGreaterThan(0)
  await expect.poll(() => fixture.requests.filter((path) => path === 'local/status').length).toBeGreaterThan(checksBefore)
  await expect(page.getByLabel('Customer account', { exact: true })).toHaveValue('cli-own-account')
  await expect(page.getByRole('button', { name: 'Request local pairing' })).toHaveCount(0)
  await page.clock.fastForward(localWorkSessionMs)
  await expect(page.getByRole('alert').filter({ hasText: '8-hour local work session ended' })).toBeVisible()
  await expect(page.getByLabel('Customer account', { exact: true })).toHaveCount(0)
})
test('the embedded local-live client acknowledges its exact backend/build only after owner-approved pairing', async ({ page }) => {
  const fixture = await offlineNativeFixture(page, true)
  const app = await embeddedTeams(page, 'content')
  await expect(app.getByRole('heading', { name: 'Connect your local MSX installation' })).toBeVisible()
  expect(fixture.reports).toEqual([])
  await app.getByRole('button', { name: 'Request local pairing' }).click()
  await expect(app.getByText('A1B2C3D4', { exact: true })).toBeVisible()
  expect(fixture.reports).toEqual([])
  fixture.approve()
  await expect(app.getByText('Teams client and backend verified', { exact: true })).toBeVisible()
  expect(teamsClientReadyRequestSchema.parse(fixture.reports[0])).toMatchObject({ host: 'teams', runId: '11111111111111111111111111111111' })
})
test('CLI reviewed-write UI requires exact confirmation; cancel leaves the offline sample source untouched', async ({ page, request }) => {
  const fixture = await offlineNativeFixture(page, true, 'reviewed')
  await page.goto('/')
  await expect(page.getByText(/MSX changes require exact review and approval/)).toBeVisible()
  await page.getByRole('button', { name: 'Request local pairing' }).click()
  fixture.approve()
  await expect(page.getByText('Live MSX - Azure CLI reviewed read/write', { exact: true })).toBeVisible()
  const { opportunity } = await chooseOpportunity(page, request)
  const before = await post(request, 'getOpportunityContext', { opportunityId: opportunity.id })
  await page.getByText('Opportunity notes and reviewed updates', { exact: true }).click()
  await page.getByLabel('Opportunity notes').fill('CLI reviewed offline sample change')
  await page.getByRole('button', { name: 'Review opportunity update' }).click()
  await expect(page.getByRole('dialog', { name: 'Review exact changes' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel review' }).click()
  expect(await post(request, 'getOpportunityContext', { opportunityId: opportunity.id })).toEqual(before)
  expect(fixture.requests.filter((path) => path === 'actions/commit')).toHaveLength(0)
  await page.getByRole('button', { name: 'Review opportunity update' }).click()
  await page.getByLabel('Review reason').fill('Approved offline fixture change')
  await page.getByRole('button', { name: 'Confirm selected changes' }).click()
  await expect(page.getByRole('dialog', { name: 'Review exact changes' })).not.toBeVisible()
  expect((await post(request, 'getOpportunityContext', { opportunityId: opportunity.id })).opportunity.comments).toBe('CLI reviewed offline sample change')
  expect(fixture.requests.filter((path) => path === 'actions/commit')).toHaveLength(1)
})

test('CLI meeting capture offers manual input, disables unsupported Graph lookup and requires exact review before applying its draft', async ({ page, request }) => {
  const fixture = await offlineNativeFixture(page, true, 'reviewed')
  await page.route('**/api/teams/meetings/**', (route) => route.continue())
  const graphRequests: string[] = []
  page.on('request', (entry) => {
    if (/\/meetings\/(?:resolve|acquire)$/.test(entry.url())) graphRequests.push(entry.url())
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Request local pairing' }).click()
  fixture.approve()
  const { opportunity } = await chooseOpportunity(page, request)
  const before = await post(request, 'getOpportunityContext', { opportunityId: opportunity.id })
  await page.getByText('Tools', { exact: true }).click()
  await page.getByRole('button', { name: 'Meetings', exact: true }).click()
  await page.getByRole('tab', { name: 'Capture', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Paste / upload', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Teams meeting', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Automatic meeting-link lookup is unavailable in this Azure CLI profile.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Verify meeting and acquire transcript', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Paste / upload', exact: true }).click()
  await page.getByLabel('Meeting classification', { exact: true }).selectOption('customer')
  await page.getByRole('textbox', { name: 'Transcript text', exact: true }).fill('Seller: We have sign-off to spend 987 thousand this quarter.')
  await page.getByRole('button', { name: 'Extract & Review', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Proposed meeting changes', exact: true })).toBeVisible()
  expect(await post(request, 'getOpportunityContext', { opportunityId: opportunity.id })).toEqual(before)
  for (const checkbox of await page.locator('#meeting-follow-up').getByRole('checkbox').all()) {
    if (await checkbox.isEnabled()) await checkbox.check()
  }
  await page.getByLabel('Meeting change reason', { exact: true }).fill('Reviewed the sanitized manual transcript evidence')
  await page.getByRole('button', { name: 'Review selected meeting changes', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Review exact changes' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel review' }).click()
  expect(await post(request, 'getOpportunityContext', { opportunityId: opportunity.id })).toEqual(before)
  expect(fixture.requests.filter((path) => path === 'actions/commit')).toHaveLength(0)
  await page.getByRole('button', { name: 'Review selected meeting changes', exact: true }).click()
  await dialog.getByRole('textbox', { name: 'Review reason', exact: true }).fill('Explicitly approve only the selected sample changes')
  const committed = page.waitForResponse((response) => response.url().endsWith('/actions/commit'))
  await dialog.getByRole('button', { name: 'Confirm selected changes', exact: true }).click()
  const receipt = actionReceiptSchema.parse(await (await committed).json())
  expect(receipt.state).toBe('confirmed')
  const result = meetingChangeSetResultSchema.parse(receipt.result)
  expect(result.state).toBe('applied')
  expect(result.items.some((item) => item.kind === 'field' && item.state === 'applied')).toBe(true)
  expect((await post(request, 'getOpportunityContext', { opportunityId: opportunity.id })).opportunity.comments).toContain('Meeting inject')
  expect(graphRequests).toEqual([])
})
test('CLI live profile reuses current-user pairing and automatically displays their default deal-team accounts', async ({ page }) => {
  const fixture = await offlineNativeFixture(page, true)
  await page.goto('/')
  await expect(page.getByText(/existing Azure CLI sign-in/)).toBeVisible()
  await expect(page.getByText(/launcher-cli/).first()).toBeVisible()
  expect(fixture.privateRequests()).toBe(0)
  await expect(page.getByRole('button', { name: 'Sign in with Microsoft' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Request local pairing' }).click()
  fixture.approve()
  await expect(page.getByRole('navigation', { name: 'TLC navigation' }).getByRole('button')).toHaveText(['New', 'Discover', 'Portfolio', 'Plays', 'Dashboards'])
  await expect(page.getByLabel('Customer account', { exact: true })).toHaveValue('cli-own-account')
  await expect(page.getByLabel('Customer account', { exact: true }).getByRole('option', { name: 'Offline signed-in user deal-team account' })).toHaveCount(1)
  await expect(page.getByText('Live MSX - Azure CLI read-only', { exact: true })).toBeVisible()
  expect(fixture.requests).toContain('operations/getPortfolioWorkspace')
  expect(fixture.requests.some((path) => path.includes('connect') || path.includes('actions/'))).toBe(false)
})
test('native bootstrap shows truthful limits and cannot launch sign-in or expose private data before pairing', async ({ page }) => {
  const fixture = await offlineNativeFixture(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Connect your local MSX installation' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in with Microsoft' })).toHaveCount(0)
  expect(fixture.privateRequests()).toBe(0)
  await page.getByRole('button', { name: 'Request local pairing' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Pairing code' })).toContainText('A1B2C3D4')
  expect(fixture.privateRequests()).toBe(0)
  await page.getByText('Capabilities and limitations', { exact: true }).click()
  await expect(page.getByText('Cloud bot and message extensions', { exact: true })).toBeVisible()
  for (const width of [1024, 390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
})
test('owner-approved native fixture opens the full personal workbench and revokes only this page', async ({ page }) => {
  const fixture = await offlineNativeFixture(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Request local pairing' }).click()
  await expect(page.getByText('A1B2C3D4', { exact: true })).toBeVisible()
  fixture.approve()
  const navigation = page.getByRole('navigation', { name: 'TLC navigation' })
  await expect(navigation.getByRole('button')).toHaveText(['New', 'Discover', 'Portfolio', 'Plays', 'Dashboards'])
  await page.getByText('Live MSX: this device - connected', { exact: true }).click()
  await expect(page.getByText('offline-owner@example.test', { exact: true })).toBeVisible()
  const stored = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]))
  expect(stored).not.toContain(fixture.token)
  await page.getByRole('button', { name: 'Disconnect this page' }).click()
  await expect(page.getByRole('heading', { name: 'Connect your local MSX installation' })).toBeVisible()
  await expect(page.getByText('offline-owner@example.test', { exact: true })).toHaveCount(0)
  expect(fixture.requests).toContain('local/revoke')
  expect(fixture.requests.some((path) => path.includes('approve') || path.includes('connect'))).toBe(false)
})
test('lost native authorization clears private account/status UI rather than returning sample data', async ({ page }) => {
  const fixture = await offlineNativeFixture(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Request local pairing' }).click()
  fixture.approve()
  await expect(page.getByRole('button', { name: 'Portfolio', exact: true })).toBeVisible()
  await page.getByText('Live MSX: this device - connected', { exact: true }).click()
  await expect(page.getByText('offline-owner@example.test', { exact: true })).toBeVisible()
  fixture.invalidate()
  await page.getByRole('button', { name: 'Plays', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Connect your local MSX installation' })).toBeVisible()
  await expect(page.getByText('offline-owner@example.test', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Sample user', { exact: true })).toHaveCount(0)
})
