import { expect, test } from '@playwright/test'
import { chooseOpportunity, openUtility, post } from './helpers.js'

test('extension-first destinations are real workspaces and Portfolio is the default', async ({ page }) => {
  await page.goto('/')
  const navigation = page.getByRole('navigation', { name: 'TLC navigation' })
  await expect(navigation.getByRole('button')).toHaveText(['New', 'Discover', 'Portfolio', 'Plays', 'Dashboards'])
  await expect(navigation.getByRole('button', { name: 'Portfolio', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByLabel('Customer account', { exact: true })).toBeVisible()
  await navigation.getByRole('button', { name: 'Discover', exact: true }).click()
  await expect(page.getByLabel('Solution Engineer domain')).toBeVisible()
  await navigation.getByRole('button', { name: 'New', exact: true }).click()
  await expect(page.getByText('Creation changes the sample SQLite store only.')).toBeVisible()
  await navigation.getByRole('button', { name: 'Dashboards', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Dashboard workspace' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Seller Dashboard', exact: true })).toBeVisible()
  await openUtility(page, 'Context settings')
  await expect(page.getByRole('heading', { name: 'Configure a Teams context' })).toBeVisible()
})

test('Portfolio uses the three-pane workbench and one MCEM evaluation for both views', async ({ page, request }) => {
  let evaluations = 0
  page.on('request', (entry) => { if (entry.url().endsWith('/operations/runMcemCoach')) evaluations++ })
  await page.goto('/')
  await chooseOpportunity(page, request)
  await expect(page.locator('#portfolio-accounts-panel')).toBeVisible()
  await expect(page.locator('#portfolio-details-panel')).toBeVisible()
  const actions = page.getByRole('complementary', { name: 'Next Best Actions' })
  await expect(actions).toBeVisible()
  await page.getByRole('tab', { name: 'Overview', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Milestones', exact: true })).toBeVisible()
  await actions.getByRole('button', { name: 'Run MCEM Coach', exact: true }).click()
  await expect(actions.getByText('Read-only preview.', { exact: false })).toBeVisible()
  await page.getByRole('tab', { name: 'MCEM Stages', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Stage readiness', exact: true })).toBeVisible()
  await expect.poll(() => evaluations).toBe(1)
  await page.getByRole('button', { name: 'Hide Accounts panel', exact: true }).click()
  await expect(page.locator('#portfolio-accounts-panel')).toBeHidden()
  await page.getByRole('button', { name: 'Show Accounts panel', exact: true }).click()
  await expect(page.locator('#portfolio-accounts-panel')).toBeVisible()
})

test('guidance drafts and selected scope survive navigation without browser persistence', async ({ page, request }) => {
  await page.goto('/')
  const { opportunity } = await chooseOpportunity(page, request)
  await page.getByRole('tab', { name: 'Guidance', exact: true }).click()
  await page.getByLabel('Ask TLC', { exact: true }).fill('Unsaved private test draft')
  await page.getByRole('button', { name: 'Plays', exact: true }).click()
  await page.getByRole('button', { name: 'Portfolio', exact: true }).click()
  await expect(page.getByLabel('Ask TLC', { exact: true })).toHaveValue('Unsaved private test draft')
  await expect(page.getByRole('heading', { name: opportunity.name, exact: true })).toBeVisible()
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('Unsaved private test draft')
})

test('Plays render structured results and reopen authorized run history', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Plays', exact: true }).click()
  await page.getByLabel('Workflow', { exact: true }).selectOption('WF-001')
  await page.getByRole('button', { name: 'Run workflow', exact: true }).click()
  await expect(page.getByTestId('workflow-status')).toContainText('completed')
  await expect(page.getByRole('region', { name: 'Play result', exact: true })).toBeVisible()
  await expect(page.getByText('Evidence and source health', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Portfolio', exact: true }).click()
  await page.getByRole('button', { name: 'Plays', exact: true }).click()
  const history = page.getByRole('region', { name: 'Play history' })
  await expect(history).toBeVisible()
  await history.getByRole('button').first().click()
  await expect(page.getByRole('region', { name: 'Play result', exact: true })).toBeVisible()
})

test('bound tabs preserve account and opportunity scope instead of accepting unrelated navigation', async ({ page, request }) => {
  const accounts: Array<{ id: string }> = await post(request, 'listAccounts', {})
  const account = accounts[0]!
  const opportunities: Array<{ id: string }> = await post(request, 'listOpportunities', { accountId: account.id })
  const opportunity = opportunities[0]!
  const response = await request.post('/api/teams/contexts', { data: { kind: 'channel', contextId: 'sample-revamp-context', accountId: account.id, opportunityId: opportunity.id } })
  expect(response.ok()).toBe(true)
  const binding = await response.json() as { id: string }
  await page.goto(`/?surface=channel&bindingId=${encodeURIComponent(binding.id)}&view=dashboard`)
  await expect(page.getByLabel('Customer account', { exact: true })).toBeDisabled()
  await expect(page.getByLabel('Opportunity', { exact: true })).toBeDisabled()
  await expect(page.getByLabel('Opportunity', { exact: true })).toHaveValue(opportunity.id)
  await expect(page.getByRole('combobox', { name: 'Search accounts and opportunities' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Dashboards', exact: true })).toBeHidden()
})

test('meeting canvas exposes concise Prep, Capture and Follow-up tasks', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/?surface=meeting')
  const tasks = page.getByRole('tablist', { name: 'Meeting tasks' })
  await expect(tasks).toBeVisible()
  await tasks.getByRole('tab', { name: 'Prep', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Meeting preparation', exact: true })).toBeVisible()
  await tasks.getByRole('tab', { name: 'Capture', exact: true }).click()
  await expect(page.getByLabel('Bundled sample transcript')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('Portfolio reflows without page overflow at all acceptance widths', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#portfolio-details-panel')).toBeVisible()
  for (const width of [1556, 1440, 1280, 1024, 768, 390, 360, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(page.getByRole('button', { name: 'Portfolio', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
})

test('wide Portfolio tables keep Stage readable instead of breaking labels into letters', async ({ page }) => {
  await page.setViewportSize({ width: 1556, height: 900 })
  await page.goto('/')
  const header = page.locator('#portfolio-accounts-panel').getByRole('columnheader', { name: 'Stage', exact: true })
  await expect(header).toBeVisible()
  const lines = await header.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    return new Set(Array.from(range.getClientRects()).map((rectangle) => rectangle.top)).size
  })
  expect(lines).toBe(1)
})

test('header search opens an accessible account using the keyboard', async ({ page, request }) => {
  const accounts: Array<{ id: string; name: string }> = await post(request, 'listAccounts', {})
  const target = accounts[1]!
  await page.goto('/')
  const search = page.getByRole('combobox', { name: 'Search accounts and opportunities' })
  await search.fill(target.name)
  await expect(page.getByRole('listbox', { name: 'Search results' }).getByRole('option', { name: target.name, exact: true })).toBeVisible()
  await search.press('Enter')
  await expect(page.getByLabel('Customer account', { exact: true })).toHaveValue(target.id)
  await expect(search).toHaveValue('')
})

test('an invalid Play link reports its error rather than silently clearing it', async ({ page }) => {
  await page.goto('/?view=plays&runId=invalid-reference')
  await expect(page.getByRole('alert').filter({ hasText: 'linked Play run reference is invalid' })).toBeVisible()
})

test('a late guidance response cannot replace the next selected opportunity', async ({ page, request }) => {
  await page.goto('/')
  const current = await chooseOpportunity(page, request)
  const accounts: Array<{ id: string }> = await post(request, 'listAccounts', {})
  const next = accounts.find((account) => account.id !== current.account.id)!
  let unblock: () => void = () => undefined
  let started: () => void = () => undefined
  const waiting = new Promise<void>((resolve) => { started = resolve })
  const blocked = new Promise<void>((resolve) => { unblock = resolve })
  await page.route('**/api/teams/operations/runAgentTask', async (route) => {
    const response = await route.fetch()
    started()
    await blocked
    await route.fulfill({ response })
  })
  await page.getByRole('tab', { name: 'Guidance', exact: true }).click()
  await page.getByRole('button', { name: 'Run guidance', exact: true }).click()
  await waiting
  await page.getByLabel('Customer account', { exact: true }).selectOption(next.id)
  unblock()
  await expect(page.getByLabel('Customer account', { exact: true })).toHaveValue(next.id)
  await expect(page.getByRole('heading', { name: current.opportunity.name, exact: true })).toBeHidden()
  await expect(page.getByRole('region', { name: 'Grounded TLC response' })).toBeHidden()
})

test('search clears its old index when a fresh source authorization check fails', async ({ page, request }) => {
  const accounts: Array<{ name: string }> = await post(request, 'listAccounts', {})
  const name = accounts[0]!.name
  await page.goto('/')
  const search = page.getByRole('combobox', { name: 'Search accounts and opportunities' })
  await search.fill(name)
  const suggestions = page.getByRole('listbox', { name: 'Search results' })
  await expect(suggestions.getByRole('option', { name, exact: true })).toBeVisible()
  await search.press('Escape')
  await page.getByRole('button', { name: 'Portfolio', exact: true }).focus()
  await page.route('**/api/teams/operations/getPortfolioIndex', (route) => route.fulfill({
    status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'account_access_denied' })
  }))
  await search.fill(name)
  await expect(page.getByRole('alert').filter({ hasText: 'account access denied' })).toBeVisible()
  await expect(suggestions.getByRole('option', { name, exact: true })).toHaveCount(0)
})

test('a late Play handoff cannot populate a different selected scope', async ({ page }) => {
  await page.goto('/?view=plays')
  await page.getByLabel('Workflow', { exact: true }).selectOption('WF-001')
  await page.getByRole('button', { name: 'Run workflow', exact: true }).click()
  await expect(page.getByTestId('workflow-status')).toContainText('completed')
  let unblock: () => void = () => undefined
  let started: () => void = () => undefined
  const waiting = new Promise<void>((resolve) => { started = resolve })
  const blocked = new Promise<void>((resolve) => { unblock = resolve })
  await page.route('**/api/teams/operations/workflows.guidance', async (route) => {
    const response = await route.fetch()
    started()
    await blocked
    await route.fulfill({ response })
  })
  await page.getByRole('button', { name: 'Prepare guidance', exact: true }).first().click()
  await waiting
  await page.getByLabel('Play scope', { exact: true }).selectOption('account')
  unblock()
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('heading', { name: 'Review guidance handoff', exact: true })).toBeHidden()
})
