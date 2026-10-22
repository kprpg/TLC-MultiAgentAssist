import { expect, test, _electron as electron, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Account, DiscoverableOpportunity } from '../../../packages/common/index.js'
import { opportunitySchema } from '../../../packages/common/contracts/index.js'

declare global { var tlcDiscoveryCaptureCount: number }

const portfolioAccounts: Account[] = [
  { id: 'account-alpha', name: 'Alpha Corp', segment: 'Enterprise' },
  { id: 'account-beta', name: 'Beta Health', segment: 'Enterprise', provenance: 'manual' },
  { id: 'account-zulu', name: 'Zulu Systems', segment: 'Enterprise' }
]

const discoveryRows: DiscoverableOpportunity[] = [
  { id: 'zulu', name: 'Zulu renewal', accountId: 'account-zulu', accountName: 'Zulu Systems', recordedStage: 3, onDealTeam: true },
  { id: 'alpha-team', name: 'Alpha analysis', accountId: 'account-alpha', accountName: 'Alpha Corp', recordedStage: 2, onDealTeam: true },
  { id: 'beta', name: 'Beta platform', accountId: 'account-beta', accountName: 'Beta Health', recordedStage: 1, onDealTeam: false },
  { id: 'alpha-add', name: 'Alpha infrastructure', accountId: 'account-alpha', accountName: 'Alpha Corp', recordedStage: 5, onDealTeam: false }
].map((item) => ({ ...item, domain: 'infra', value: 100, currency: 'USD', closeDate: '2026-12-31', technicalCapability: 'Cloud infrastructure' }))

function snapshot(rows: DiscoverableOpportunity[]) {
  return {
    contractVersion: '1.0', generatedAt: '2026-10-21T12:00:00.000Z', accounts: portfolioAccounts,
    portfolioOpportunities: rows.filter((item) => item.onDealTeam).map((item) => opportunitySchema.parse(item)),
    opportunities: [...rows, ...rows.filter((item) => item.id === 'zulu').map((item) => ({ ...item, domain: 'data' }))],
    milestoneTeamOpportunityIds: []
  }
}

async function expectActionColor(action: Locator, data: Locator, expectedColor: string): Promise<void> {
  await expect(action).toHaveCSS('color', expectedColor)
  expect(await data.evaluate((element) => getComputedStyle(element).color)).not.toBe(expectedColor)
  const contrast = await action.evaluate((element) => {
    function rgba(value: string) {
      const [red, green, blue, alpha = 1] = value.match(/[\d.]+/g)?.map(Number) ?? []
      if (red === undefined || green === undefined || blue === undefined) throw new Error(`Unsupported rendered color: ${value}`)
      return { red, green, blue, alpha }
    }
    const ancestors: Element[] = []
    for (let current: Element | null = element; current; current = current.parentElement) ancestors.unshift(current)
    let background = { red: 255, green: 255, blue: 255 }
    for (const ancestor of ancestors) {
      const layer = rgba(getComputedStyle(ancestor).backgroundColor)
      background = {
        red: layer.red * layer.alpha + background.red * (1 - layer.alpha),
        green: layer.green * layer.alpha + background.green * (1 - layer.alpha),
        blue: layer.blue * layer.alpha + background.blue * (1 - layer.alpha)
      }
    }
    function luminance(color: { red: number; green: number; blue: number }) {
      const linear = (channel: number) => channel / 255 <= 0.04045 ? channel / 255 / 12.92 : ((channel / 255 + 0.055) / 1.055) ** 2.4
      return 0.2126 * linear(color.red) + 0.7152 * linear(color.green) + 0.0722 * linear(color.blue)
    }
    const foregroundLuminance = luminance(rgba(getComputedStyle(element).color))
    const backgroundLuminance = luminance(background)
    return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  })
  expect(contrast).toBeGreaterThanOrEqual(4.5)
}

async function verifyPortfolioActionColors(page: Page, host: 'desktop' | 'web' | 'vscode', accent: string, hover: string): Promise<void> {
  if (host === 'vscode') {
    const accounts = page.locator('#portfolio-accounts-panel')
    const name = accounts.locator('.record-name-text').first()
    const remove = accounts.getByRole('button', { name: 'Remove this customer', exact: true })
    await expectActionColor(remove, name, accent)
    await remove.hover()
    await expectActionColor(remove, name, hover)
    await expectActionColor(accounts.getByRole('button', { name: 'Remove customer', exact: true }), name, accent)
    await expectActionColor(accounts.getByRole('button', { name: 'Asc', exact: true }), name, accent)
    await expectActionColor(accounts.getByRole('button', { name: 'Comments', exact: true }).first(), name, accent)
    await expectActionColor(accounts.getByRole('button', { name: 'Add customer', exact: true }), name, accent)
    return
  }
  const accounts = page.getByRole('region', { name: 'Accounts blade' })
  const row = accounts.locator('.account-row').first()
  const name = row.locator('.account-button strong')
  const remove = row.getByRole('button', { name: 'Remove this customer', exact: true })
  await expectActionColor(remove, name, accent)
  await remove.hover()
  await expectActionColor(remove, name, hover)
  await remove.press('Tab')
  await remove.focus()
  await expect(remove).toHaveCSS('outline-style', 'solid')
  const removeChooser = accounts.getByRole('button', { name: 'Remove customer', exact: true })
  await expectActionColor(removeChooser, name, accent)
  await expect(removeChooser.locator('svg')).toHaveCSS('color', accent)
  await row.locator('.account-button').click()
  const opportunities = page.getByRole('region', { name: 'Opportunities blade' })
  await expectActionColor(opportunities.getByRole('button', { name: 'Sort opportunities', exact: true }), opportunities.locator('.opportunity-link-button strong').first(), accent)
}

async function verifyDiscoveryControls(page: Page, host: 'desktop' | 'web' | 'vscode', accent = 'rgb(15, 108, 189)', danger = 'rgb(209, 52, 56)'): Promise<void> {
  const panel = page.getByRole('region', { name: 'Discover opportunities' })
  await expect(panel.getByText('Review all active opportunities for visible accounts and add or remove yourself from the Deal Team — or expand an opportunity to join a milestone team without joining the Deal Team. Deal Team or milestone-team membership brings an opportunity into Portfolio.', { exact: true })).toBeVisible()
  if (host !== 'vscode') {
    const toolbar = panel.locator('.discover-toolbar')
    const switcher = toolbar.getByRole('group', { name: 'Solution Engineer domain' })
    const domainButtons = switcher.getByRole('button')
    await expect(domainButtons).toHaveCount(8)
    const [toolbarBox, switcherBox, ...buttonBoxes] = await Promise.all([
      toolbar.boundingBox(),
      switcher.boundingBox(),
      ...Array.from({ length: 8 }, (_, index) => domainButtons.nth(index).boundingBox())
    ])
    expect(toolbarBox).not.toBeNull()
    expect(switcherBox).not.toBeNull()
    expect(switcherBox!.width / toolbarBox!.width).toBeGreaterThan(0.8)
    const buttonTops = buttonBoxes.map((box) => {
      expect(box).not.toBeNull()
      return box!.y
    })
    expect(Math.max(...buttonTops) - Math.min(...buttonTops)).toBeLessThan(2)
  }
  const table = panel.getByRole('table', { name: 'Discovered opportunities' })
  const names = table.locator('tbody > tr:not(.discover-milestones-row) > td:first-child strong')
  await expect(names).toHaveText(['Zulu renewal', 'Alpha analysis', 'Beta platform', 'Alpha infrastructure'])
  await expect(panel.getByText('Showing 4 of 4 opportunities', { exact: true })).toBeVisible()
  await panel.getByRole(host === 'vscode' ? 'tab' : 'button', { name: 'Data', exact: true }).click()
  await expect(names).toHaveText(['Zulu renewal'])
  await panel.getByRole(host === 'vscode' ? 'tab' : 'button', { name: 'Services', exact: true }).click()
  await expect(panel.getByText('Showing 0 of 0 opportunities', { exact: true })).toBeVisible()
  await panel.getByRole(host === 'vscode' ? 'tab' : 'button', { name: 'Infrastructure', exact: true }).click()
  await expect(names).toHaveCount(4)

  const accountSort = table.getByRole('button', { name: 'Sort by Account' })
  await expectActionColor(accountSort, names.first(), accent)
  await expectActionColor(panel.getByRole('button', { name: 'Add filter', exact: true }), names.first(), accent)
  await accountSort.click()
  await expect(accountSort.locator('..')).toHaveAttribute('aria-sort', 'ascending')
  await expect(names).toHaveText(['Alpha analysis', 'Alpha infrastructure', 'Beta platform', 'Zulu renewal'])
  await accountSort.press('Enter')
  await expect(accountSort.locator('..')).toHaveAttribute('aria-sort', 'descending')
  await expect(names).toHaveText(['Zulu renewal', 'Beta platform', 'Alpha analysis', 'Alpha infrastructure'])

  const stageSort = table.getByRole('button', { name: 'Sort by Stage' })
  await stageSort.click()
  await expect(stageSort.locator('..')).toHaveAttribute('aria-sort', 'ascending')
  await expect(accountSort.locator('..')).toHaveAttribute('aria-sort', 'none')
  await expect(names).toHaveText(['Beta platform', 'Alpha analysis', 'Zulu renewal', 'Alpha infrastructure'])
  await stageSort.click()
  await expect(stageSort.locator('..')).toHaveAttribute('aria-sort', 'descending')
  await expect(names).toHaveText(['Alpha infrastructure', 'Zulu renewal', 'Alpha analysis', 'Beta platform'])

  const actionSort = table.getByRole('button', { name: 'Sort by Action' })
  await actionSort.click()
  await expect(names).toHaveText(['Alpha infrastructure', 'Beta platform', 'Alpha analysis', 'Zulu renewal'])
  await actionSort.click()
  await expect(actionSort.locator('..')).toHaveAttribute('aria-sort', 'descending')
  await expect(names).toHaveText(['Alpha analysis', 'Zulu renewal', 'Alpha infrastructure', 'Beta platform'])
  const betaRow = table.getByRole('row').filter({ hasText: 'Beta platform' })
  await betaRow.getByRole('button', { name: 'Add me', exact: true }).click()
  await expect(betaRow).toContainText('On deal team')
  await expect(names).toHaveText(['Alpha analysis', 'Beta platform', 'Zulu renewal', 'Alpha infrastructure'])
  await expectActionColor(betaRow.getByRole('button', { name: 'Remove me', exact: true }), betaRow.locator('td').first(), danger)
  const remove = betaRow.getByRole('button', { name: 'Remove me', exact: true })
  const confirmation = page.getByRole('dialog', { name: 'Remove from Deal Team' })
  await remove.click()
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(confirmation).not.toBeVisible()
  await expect(betaRow).toContainText('On deal team')
  await remove.click()
  await page.keyboard.press('Escape')
  await expect(confirmation).not.toBeVisible()
  await expect(betaRow).toContainText('On deal team')
  await remove.click()
  await confirmation.getByRole('button', { name: 'Remove membership' }).click()
  await expect(confirmation.getByRole('alert')).toContainText('MSX could not remove your Deal Team membership.')
  await expect(betaRow).toContainText('On deal team')
  await confirmation.getByRole('button', { name: 'Remove membership' }).click()
  await expect(confirmation).not.toBeVisible()
  await expect(betaRow.getByRole('button', { name: 'Add me', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(betaRow.getByRole('button', { name: 'Add me', exact: true })).toBeVisible()
  await expect(names).toHaveText(['Alpha analysis', 'Zulu renewal', 'Alpha infrastructure', 'Beta platform'])

  if (host === 'vscode') {
    await betaRow.getByRole('button', { name: 'Show milestones for Beta platform' }).click()
    const milestonesRow = table.getByRole('row', { name: 'Beta platform milestones' })
    const milestoneAdd = milestonesRow.getByRole('button', { name: 'Add me to the team for Customer outcome validation' })
    await milestoneAdd.click()
    const milestoneRemove = milestonesRow.getByRole('button', { name: 'Remove me from the team for Customer outcome validation' })
    await expect(milestoneRemove).toHaveAttribute('aria-pressed', 'true')
    await milestoneRemove.click()
    const confirmation = page.getByRole('dialog', { name: 'Remove from milestone team' })
    await expect(confirmation).toBeVisible()
    await confirmation.getByRole('button', { name: 'Remove membership' }).click()
    await expect(milestoneAdd).toHaveAttribute('aria-pressed', 'false')
  }

  await panel.getByRole('button', { name: 'Customers equals all', exact: true }).click()
  const editor = panel.getByRole('dialog', { name: 'Customer filter' })
  await expect(editor.getByRole('searchbox', { name: 'Search customers' })).toBeFocused()
  await expect(editor.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled()
  await editor.getByRole('checkbox', { name: 'Alpha Corp', exact: true }).check()
  await editor.getByRole('checkbox', { name: 'Beta Health', exact: true }).check()
  await editor.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(panel.getByText('Showing 3 of 4 opportunities', { exact: true })).toBeVisible()
  await expect(names).toHaveText(['Alpha analysis', 'Alpha infrastructure', 'Beta platform'])
  await panel.getByRole('button', { name: 'Add filter', exact: true }).click()
  await expect(editor.getByRole('radio', { name: 'does not equal (exclude)', exact: true })).toBeChecked()
  await editor.getByRole('checkbox', { name: 'Alpha Corp', exact: true }).check()
  await editor.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(names).toHaveText(['Beta platform'])
  await expect(panel.getByText('Showing 1 of 4 opportunities', { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Customers does not equal Alpha Corp', exact: true }).click()
  await expect(editor).toBeVisible()
  await panel.getByRole('button', { name: 'Remove exclude customer filter' }).click()
  await expect(editor).toHaveCount(0)
  await expect(names).toHaveCount(3)
  await panel.getByRole('button', { name: 'Remove include customer filter' }).click()
  await expect(names).toHaveCount(4)

  await panel.getByRole('button', { name: 'Add filter', exact: true }).click()
  await editor.getByRole('radio', { name: 'does not equal (exclude)', exact: true }).check()
  await editor.getByRole('checkbox', { name: 'Alpha Corp', exact: true }).check()
  await editor.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(names).toHaveText(['Zulu renewal', 'Beta platform'])
  await panel.getByRole('button', { name: 'Remove exclude customer filter' }).click()
  await expect(names).toHaveCount(4)

  await panel.getByRole('button', { name: 'Customers equals all', exact: true }).click()
  await editor.getByRole('searchbox', { name: 'Search customers' }).fill('zULu')
  await editor.getByRole('checkbox', { name: 'Select all matching customers', exact: true }).check()
  await editor.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(names).toHaveText(['Zulu renewal'])
  await panel.getByRole('button', { name: 'Customers equals Zulu Systems', exact: true }).click()
  await editor.getByRole('checkbox', { name: 'Zulu Systems', exact: true }).uncheck()
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(names).toHaveText(['Zulu renewal'])
  await panel.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await expect(names).toHaveCount(4)

  const allCustomers = panel.getByRole('button', { name: 'Customers equals all', exact: true })
  await allCustomers.click()
  await editor.getByRole('searchbox', { name: 'Search customers' }).fill('No matching customer')
  await expect(editor.getByText('No customers match your search.')).toBeVisible()
  await editor.getByRole('searchbox', { name: 'Search customers' }).press('Escape')
  await expect(editor).toHaveCount(0)
  await expect(allCustomers).toBeFocused()
  await expect(names).toHaveCount(4)
  await allCustomers.click()
  await panel.getByRole('heading', { name: 'Discover opportunities', exact: true }).click()
  await expect(editor).toHaveCount(0)

  await allCustomers.click()
  await editor.getByRole('checkbox', { name: 'Alpha Corp', exact: true }).check()
  await editor.getByRole('button', { name: 'Apply', exact: true }).click()
  await panel.getByRole('button', { name: 'Add filter', exact: true }).click()
  await editor.getByRole('checkbox', { name: 'Alpha Corp', exact: true }).check()
  await editor.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(panel.getByText('No opportunities match your customer filters. Clear filters to show all customers.')).toBeVisible()
  await expect(panel.getByText('Showing 0 of 4 opportunities', { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await expect(names).toHaveCount(4)

  await allCustomers.click()
  await editor.getByRole('checkbox', { name: 'Alpha Corp', exact: true }).check()
  await editor.getByRole('button', { name: 'Apply', exact: true }).click()
  await panel.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(names).toHaveText(['Alpha analysis', 'Alpha infrastructure'])
  await panel.getByRole(host === 'vscode' ? 'tab' : 'button', { name: 'Data', exact: true }).click()
  await expect(panel.getByText('Showing 0 of 1 opportunities', { exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Customers equals Alpha Corp', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Customers equals Alpha Corp', exact: true }).click()
  await expect(editor.getByRole('checkbox', { name: 'Alpha Corp', exact: true })).toBeChecked()
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await panel.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await expect(names).toHaveText(['Zulu renewal'])
  await expect(actionSort.locator('..')).toHaveAttribute('aria-sort', 'descending')

  await page.setViewportSize({ width: 390, height: 844 })
  await allCustomers.click()
  await expect(editor).toBeVisible()
  expect(await editor.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return bounds.left >= 0 && bounds.right <= document.documentElement.clientWidth
  })).toBe(true)
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
}

test('filters and sorts Discovery in the web UI', async ({ page }) => {
  const rows = structuredClone(discoveryRows)
  let snapshotReads = 0
  let removalAttempts = 0
  const errors: Error[] = []
  page.on('pageerror', (error) => errors.push(error))
  await page.route('**/', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, body: (await response.text()).replace('<head>', '<head><meta name="tlc-data-mode" content="sample">') })
  })
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/me') await route.fulfill({ json: { email: 'sample@example.test' } })
    else if (path === '/api/discovery/snapshot') {
      snapshotReads++
      await route.fulfill({ json: snapshot(rows) })
    }
    else if (path === '/api/portfolio/index') await route.fulfill({ json: {
      contractVersion: '1.0', accounts: portfolioAccounts,
      opportunities: rows.filter((item) => item.onDealTeam).map((item) => opportunitySchema.parse(item))
    } })
    else if (path === '/api/accounts') await route.fulfill({ json: portfolioAccounts })
    else if (path.startsWith('/api/accounts/') && path.endsWith('/opportunities')) await route.fulfill({ json: rows.filter((item) => item.accountId === path.split('/')[3] && item.onDealTeam) })
    else if (path.endsWith('/milestones')) await route.fulfill({ json: [] })
    else if (path.startsWith('/api/discover/')) {
      await route.fulfill({ json: path.endsWith('/data') ? rows.filter((item) => item.id === 'zulu').map((item) => ({ ...item, domain: 'data' })) : rows })
    } else if (path.endsWith('/deal-team')) {
      const id = path.split('/')[3]
      const onDealTeam = route.request().method() === 'POST'
      if (!onDealTeam && ++removalAttempts === 1) {
        await route.fulfill({ status: 403, json: { error: 'MSX could not remove your Deal Team membership.' } })
        return
      }
      for (const row of rows) if (row.id === id) row.onDealTeam = onDealTeam
      await route.fulfill({ json: { opportunityId: id, onDealTeam, ...(onDealTeam ? { alreadyMember: false } : { alreadyAbsent: false }) } })
    } else await route.fulfill({ status: 500, json: { error: `Unexpected test request: ${path}` } })
  })
  await page.goto('/')
  await verifyPortfolioActionColors(page, 'web', 'rgb(15, 108, 189)', 'rgb(17, 94, 163)')
  await page.locator('.rail-button[title="Discover opportunities"]').click()
  await verifyDiscoveryControls(page, 'web')
  expect(snapshotReads).toBe(3)
  const panel = page.getByRole('region', { name: 'Discover opportunities' })
  await panel.getByRole('button', { name: 'Customers equals all', exact: true }).click()
  await expect(panel.getByRole('dialog', { name: 'Customer filter' }).getByRole('checkbox', { name: 'Beta Health', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('filters and sorts Discovery through the desktop IPC bridge', async () => {
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-discovery-test-'))
  test.slow()
  const app = await electron.launch({
    args: [resolve('apps', 'desktop'), `--user-data-dir=${userDataDirectory}`],
    env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_UI_MODE: '' }
  })
  try {
    const page = await app.firstWindow()
    const errors: Error[] = []
    page.on('pageerror', (error) => errors.push(error))
    await app.evaluate(({ ipcMain }, rows) => {
      let removalAttempts = 0
      globalThis.tlcDiscoveryCaptureCount = 0
      for (const channel of ['tlc:discovery-snapshot', 'tlc:join-deal-team', 'tlc:leave-deal-team', 'tlc:cache-control']) ipcMain.removeHandler(channel)
      // Synthetic Discovery replaces the physical owner here; unrelated real-Portfolio metadata must not invalidate it.
      ipcMain.handle('tlc:cache-control', () => ({
        contractVersion: '1.0', state: { revision: 0, dataRevision: 0, generation: 0, refreshing: false, stale: false }
      }))
      ipcMain.handle('tlc:discovery-snapshot', () => {
        globalThis.tlcDiscoveryCaptureCount++
        return {
        contractVersion: '1.0', generatedAt: '2026-10-21T12:00:00.000Z',
        accounts: [...new Map(rows.map((item) => [item.accountId, { id: item.accountId, name: item.accountName!, segment: 'test' }])).values()],
        portfolioOpportunities: rows.filter((item) => item.onDealTeam).map(({ id, accountId, name, recordedStage, value, currency, closeDate }) =>
          ({ id, accountId, name, recordedStage, value, currency, closeDate })),
        opportunities: [...rows, ...rows.filter((item) => item.id === 'zulu').map((item) => ({ ...item, domain: 'data' }))],
        milestoneTeamOpportunityIds: []
        }
      })
      ipcMain.handle('tlc:join-deal-team', (_event, id: string) => {
        for (const row of rows) if (row.id === id) row.onDealTeam = true
        return { opportunityId: id, onDealTeam: true, alreadyMember: false }
      })
      ipcMain.handle('tlc:leave-deal-team', (_event, id: string) => {
        if (++removalAttempts === 1) throw new Error('MSX could not remove your Deal Team membership.')
        for (const row of rows) if (row.id === id) row.onDealTeam = false
        return { opportunityId: id, onDealTeam: false, alreadyAbsent: false }
      })
    }, structuredClone(discoveryRows))
    await verifyPortfolioActionColors(page, 'desktop', 'rgb(15, 108, 189)', 'rgb(17, 94, 163)')
    await page.locator('.rail-button[title="Discover opportunities"]').click()
    await verifyDiscoveryControls(page, 'desktop')
    expect(await app.evaluate(() => globalThis.tlcDiscoveryCaptureCount)).toBe(3)
    expect(errors).toEqual([])
  } finally {
    await app.close()
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})

for (const theme of [
  { name: 'dark', accent: 'rgb(55, 148, 255)', hover: 'rgb(117, 190, 255)', danger: 'rgb(244, 135, 113)', colors: '--vscode-editor-background:#1e1e1e;--vscode-editorWidget-background:#252526;--vscode-foreground:#cccccc;--vscode-descriptionForeground:#969696;--vscode-panel-border:#454545;--vscode-textLink-foreground:#3794ff;--vscode-textLink-activeForeground:#75beff;--vscode-list-activeSelectionBackground:#04395e;--vscode-list-activeSelectionForeground:#ffffff;--vscode-errorForeground:#f48771' },
  { name: 'light', accent: 'rgb(0, 106, 177)', hover: 'rgb(0, 90, 158)', danger: 'rgb(161, 38, 13)', colors: '--vscode-editor-background:#ffffff;--vscode-editorWidget-background:#f3f3f3;--vscode-foreground:#333333;--vscode-descriptionForeground:#616161;--vscode-panel-border:#d1d1d1;--vscode-textLink-foreground:#006ab1;--vscode-textLink-activeForeground:#005a9e;--vscode-list-activeSelectionBackground:#0060c0;--vscode-list-activeSelectionForeground:#ffffff;--vscode-errorForeground:#a1260d' }
]) test(`filters and sorts Discovery in the VS Code ${theme.name} webview`, async ({ page }) => {
  const errors: Error[] = []
  page.on('pageerror', (error) => errors.push(error))
  await page.route('**/', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><head><style>:root{${theme.colors};--vscode-focusBorder:#0078d4;--vscode-font-family:"Segoe UI",sans-serif;--vscode-button-background:#0e639c;--vscode-button-foreground:#ffffff;--vscode-list-hoverBackground:transparent;--vscode-toolbar-hoverBackground:transparent}</style></head><body><div id="root" data-mode="sample"></div></body></html>`
  }))
  await page.addInitScript(({ rows, accounts }) => {
    globalThis.tlcDiscoveryCaptureCount = 0
    window.confirm = () => false
    let milestoneMember = false
    let removalAttempts = 0
    Object.defineProperty(window, 'acquireVsCodeApi', {
      value: () => ({
        getState: () => undefined,
        setState: () => undefined,
        postMessage: (message: { kind: string; id: string; method: string; params?: { domain?: string; opportunityId?: string; accountId?: string; milestoneId?: string } }) => {
          if (message.kind !== 'request') return
          let result: unknown
          if (message.method === 'getCurrentUserEmail') result = 'sample@example.test'
          else if (message.method === 'getPortfolioIndex') result = {
            contractVersion: '1.0', accounts, opportunities: rows.filter((item) => item.onDealTeam)
              .map(({ id, accountId, name, recordedStage, value, currency, closeDate }) => ({ id, accountId, name, recordedStage, value, currency, closeDate }))
          }
          else if (message.method === 'getDiscoverySnapshot') {
            globalThis.tlcDiscoveryCaptureCount++
            result = {
            contractVersion: '1.0', generatedAt: '2026-10-21T12:00:00.000Z', accounts,
            portfolioOpportunities: rows.filter((item) => item.onDealTeam)
              .map(({ id, accountId, name, recordedStage, value, currency, closeDate }) => ({ id, accountId, name, recordedStage, value, currency, closeDate })),
            opportunities: [...rows, ...rows.filter((item) => item.id === 'zulu').map((item) => ({ ...item, domain: 'data' }))],
            milestoneTeamOpportunityIds: milestoneMember ? ['beta'] : []
            }
          }
          else if (message.method === 'listAccounts') result = accounts
          else if (message.method === 'listOpportunities') result = rows.filter((item) => item.accountId === message.params?.accountId && item.onDealTeam)
          else if (message.method === 'listMilestones') result = []
          else if (message.method === 'discoverOpportunities') result = message.params?.domain === 'data'
            ? rows.filter((item) => item.id === 'zulu').map((item) => ({ ...item, domain: 'data' }))
            : rows
          else if (message.method === 'listDiscoverableMilestones') result = [{
            id: `${message.params?.opportunityId}-milestone`,
            opportunityId: message.params?.opportunityId,
            name: 'Customer outcome validation',
            status: 'On Track',
            commitment: 'Best case',
            onMilestoneTeam: milestoneMember
          }]
          else if (message.method === 'joinMilestoneTeam' || message.method === 'leaveMilestoneTeam') {
            milestoneMember = message.method === 'joinMilestoneTeam'
            result = {
              opportunityId: message.params?.opportunityId,
              milestoneId: message.params?.milestoneId,
              onMilestoneTeam: milestoneMember,
              ...(milestoneMember ? { alreadyMember: false } : { alreadyAbsent: false })
            }
          }
          else if (message.method === 'joinDealTeam' || message.method === 'leaveDealTeam') {
            const onDealTeam = message.method === 'joinDealTeam'
            if (!onDealTeam && ++removalAttempts === 1) {
              window.postMessage({
                kind: 'response', id: message.id, ok: false,
                error: { message: 'MSX could not remove your Deal Team membership.' }
              }, window.location.origin)
              return
            }
            for (const row of rows) if (row.id === message.params?.opportunityId) row.onDealTeam = onDealTeam
            result = { opportunityId: message.params?.opportunityId, onDealTeam, ...(onDealTeam ? { alreadyMember: false } : { alreadyAbsent: false }) }
          } else throw new Error(`Unexpected test request: ${message.method}`)
          window.postMessage({ kind: 'response', id: message.id, ok: true, result }, window.location.origin)
        }
      })
    })
  }, { rows: structuredClone(discoveryRows), accounts: portfolioAccounts })
  await page.goto('/')
  await page.addStyleTag({ path: resolve('apps', 'vscode-extension', 'dist', 'webview', 'webview.css') })
  await page.addScriptTag({ path: resolve('apps', 'vscode-extension', 'dist', 'webview', 'webview.js') })
  await verifyPortfolioActionColors(page, 'vscode', theme.accent, theme.hover)
  await page.getByRole('button', { name: 'Discover', exact: true }).click()
  await verifyDiscoveryControls(page, 'vscode', theme.accent, theme.danger)
  expect(await page.evaluate(() => globalThis.tlcDiscoveryCaptureCount)).toBe(3)
  expect(errors).toEqual([])
})
