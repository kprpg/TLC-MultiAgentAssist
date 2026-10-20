import { expect, test, type Page } from '@playwright/test'
import { z } from 'zod'
import { actionPreviewSchema, actionReceiptSchema } from '../../../packages/common/contracts/collaboration.js'
import { seDomainSchema } from '../../../packages/common/configuration/se-domains.js'
import type { DiscoverableOpportunity, Milestone } from '../../../packages/common/contracts/index.js'
import { embeddedTeams } from './helpers.js'

const opportunities: DiscoverableOpportunity[] = [
  { id: 'zulu', name: 'Zulu renewal', accountId: 'account-zulu', accountName: 'Zulu Systems', recordedStage: 3, onDealTeam: true },
  { id: 'alpha-team', name: 'Alpha analysis', accountId: 'account-alpha', accountName: 'Alpha Corp', recordedStage: 2, onDealTeam: true },
  { id: 'beta', name: 'Beta platform', accountId: 'account-beta', accountName: 'Beta Health', recordedStage: 1, onDealTeam: false },
  { id: 'alpha-add', name: 'Alpha infrastructure', accountId: 'account-alpha', accountName: 'Alpha Corp', recordedStage: 5, onDealTeam: false }
].map((item) => ({
  ...item, domain: 'infra', value: 100, currency: 'USD', closeDate: '2099-12-31', technicalCapability: 'Cloud infrastructure'
}))

async function discoveryFixture(page: Page) {
  const domains: string[] = []
  const reads: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/operations/')) reads.push(request.url().split('/').at(-1)!)
  })
  await page.route('**/api/teams/operations/discoverOpportunities', async (route) => {
    const domain = seDomainSchema.parse(route.request().postDataJSON().domain)
    domains.push(domain)
    await route.fulfill({ json: opportunities.map((item) => ({ ...item, domain })) })
  })
  return { domains, reads }
}

test('Discover reuses searchable include/exclude customer filters without extra source calls', async ({ page }) => {
  const { reads } = await discoveryFixture(page)
  await page.goto('/?view=discover')
  const panel = page.getByRole('region', { name: 'Discover opportunities', exact: true })
  const table = panel.getByRole('table', { name: 'Discovered opportunities' })
  const names = table.locator('tbody > tr:not(.discover-milestones-row) > td:first-child strong')
  await expect(names).toHaveText(opportunities.map((item) => item.name))
  await panel.getByRole('button', { name: 'Customers equals all', exact: true }).click()
  const editor = panel.getByRole('dialog', { name: 'Customer filter', exact: true })
  await expect(editor.getByRole('searchbox', { name: 'Search customers' })).toBeFocused()
  await editor.getByRole('searchbox', { name: 'Search customers' }).fill('ALPHA')
  await editor.getByRole('checkbox', { name: 'Select all matching customers' }).check()
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(names).toHaveCount(4)
  await expect(panel.getByRole('button', { name: 'Customers equals all', exact: true })).toBeFocused()

  await panel.getByRole('button', { name: 'Customers equals all', exact: true }).click()
  await editor.getByRole('searchbox', { name: 'Search customers' }).fill('alpha')
  await editor.getByRole('checkbox', { name: 'Select all matching customers' }).check()
  await editor.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(names).toHaveText(['Alpha analysis', 'Alpha infrastructure'])
  await expect(panel.getByText('Showing 2 of 4 opportunities', { exact: true })).toBeVisible()

  await panel.getByRole('button', { name: 'Add filter', exact: true }).click()
  await expect(editor.getByRole('radio', { name: 'does not equal (exclude)', exact: true })).toBeChecked()
  await editor.getByRole('checkbox', { name: 'Alpha Corp', exact: true }).check()
  await editor.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(panel.getByText('No opportunities match your customer filters. Clear filters to show all customers.', { exact: true })).toBeVisible()
  await expect(panel.getByText('No eligible opportunities for this source scope and domain.', { exact: true })).toBeHidden()
  await panel.getByRole('button', { name: 'Remove include customer filter' }).click()
  await expect(names).toHaveText(['Zulu renewal', 'Beta platform'])
  await panel.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await expect(names).toHaveCount(4)

  await panel.getByRole('button', { name: 'Add filter', exact: true }).click()
  await editor.getByRole('searchbox', { name: 'Search customers' }).fill('not a customer')
  await expect(editor.getByText('No customers match your search.', { exact: true })).toBeVisible()
  await expect(editor.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled()
  await editor.getByRole('searchbox', { name: 'Search customers' }).press('Escape')
  await expect(editor).toBeHidden()
  await expect(panel.getByRole('button', { name: 'Add filter', exact: true })).toBeFocused()
  expect(reads).toEqual(['discoverOpportunities'])
})

test('Discover sorts Account, Stage and Action and keeps filters across domain changes and refresh', async ({ page }) => {
  const { domains } = await discoveryFixture(page)
  await page.goto('/?view=discover')
  const panel = page.getByRole('region', { name: 'Discover opportunities', exact: true })
  const table = panel.getByRole('table', { name: 'Discovered opportunities' })
  const names = table.locator('tbody > tr:not(.discover-milestones-row) > td:first-child strong')
  const account = table.getByRole('button', { name: 'Sort by Account', exact: true })
  await account.click()
  await expect(account.locator('..')).toHaveAttribute('aria-sort', 'ascending')
  await expect(names).toHaveText(['Alpha analysis', 'Alpha infrastructure', 'Beta platform', 'Zulu renewal'])
  await account.press('Enter')
  await expect(names).toHaveText(['Zulu renewal', 'Beta platform', 'Alpha analysis', 'Alpha infrastructure'])
  await table.getByRole('button', { name: 'Sort by Stage', exact: true }).click()
  await expect(names).toHaveText(['Beta platform', 'Alpha analysis', 'Zulu renewal', 'Alpha infrastructure'])
  await table.getByRole('button', { name: 'Sort by Action', exact: true }).click()
  await expect(names).toHaveText(['Alpha infrastructure', 'Beta platform', 'Alpha analysis', 'Zulu renewal'])
  await expect(account.locator('..')).toHaveAttribute('aria-sort', 'none')

  await panel.getByRole('button', { name: 'Customers equals all', exact: true }).click()
  const editor = panel.getByRole('dialog', { name: 'Customer filter', exact: true })
  await editor.getByRole('checkbox', { name: 'Alpha Corp', exact: true }).check()
  await editor.getByRole('button', { name: 'Apply', exact: true }).click()
  const tabs = panel.getByRole('tablist', { name: 'Solution Engineer domain' })
  await expect(tabs.getByRole('tab')).toHaveCount(8)
  await tabs.getByRole('tab', { name: 'AI & Apps', exact: true }).click()
  await expect(tabs.getByRole('tab', { name: 'AI & Apps', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(names).toHaveText(['Alpha infrastructure', 'Alpha analysis'])
  await panel.getByRole('button', { name: 'Refresh Discover', exact: true }).click()
  await expect(names).toHaveText(['Alpha infrastructure', 'Alpha analysis'])
  await expect.poll(() => domains).toEqual(['infra', 'ai-apps', 'ai-apps'])
  await tabs.getByRole('tab', { name: 'AI & Apps', exact: true }).press('ArrowRight')
  await expect(tabs.getByRole('tab', { name: 'Security', exact: true })).toBeFocused()
  await expect(tabs.getByRole('tab', { name: 'Security', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(names).toHaveText(['Alpha infrastructure', 'Alpha analysis'])
})

test('Discover expands only requested milestones and reviews membership before changing it', async ({ page }) => {
  const { reads } = await discoveryFixture(page)
  const milestones: Milestone[] = [
    { id: 'active', opportunityId: 'beta', name: 'Sanitized active milestone', status: 'On Track', targetDate: '2099-12-31', onMilestoneTeam: false },
    { id: 'closed', opportunityId: 'beta', name: 'Closed milestone must stay hidden', status: 'Closed' },
    { id: 'cancelled', opportunityId: 'beta', name: 'Cancelled milestone must stay hidden', status: 'Cancelled' },
    { id: 'old', opportunityId: 'beta', name: 'Old milestone must stay hidden', status: 'On Track', targetDate: '2000-01-01' }
  ]
  await page.route('**/api/teams/operations/listDiscoverableMilestones', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ opportunityId: 'beta' })
    await route.fulfill({ json: milestones })
  })
  const previewInput = z.object({ operation: z.string(), input: z.record(z.string(), z.unknown()) }).strict()
  let preview: z.infer<typeof previewInput> | undefined
  let commits = 0
  await page.route('**/api/teams/actions/preview', async (route) => {
    preview = previewInput.parse(route.request().postDataJSON())
    await route.fulfill({ json: actionPreviewSchema.parse({
      contractVersion: '1.0', id: 'sanitized-preview', operation: preview.operation, digest: 'a'.repeat(64),
      expiresAt: '2099-12-31T00:00:00.000Z', input: preview.input, before: { onDealTeam: false }, state: 'awaiting-approval'
    }) })
  })
  await page.route('**/api/teams/actions/commit', async (route) => {
    if (!preview) throw new Error('Commit must follow the reviewed preview.')
    commits++
    const result = preview.operation === 'joinDealTeam'
      ? { opportunityId: 'beta', onDealTeam: true, alreadyMember: false }
      : { opportunityId: 'beta', milestoneId: 'active', onMilestoneTeam: true, alreadyMember: false }
    await route.fulfill({ json: actionReceiptSchema.parse({
      contractVersion: '1.0', id: 'sanitized-receipt', operation: preview.operation,
      state: 'confirmed', occurredAt: '2026-10-20T16:00:00.000Z', result
    }) })
  })
  await page.goto('/?view=discover')
  const panel = page.getByRole('region', { name: 'Discover opportunities', exact: true })
  const row = panel.getByRole('row').filter({ hasText: 'Beta platform' })
  await row.getByRole('button', { name: 'Add me', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Review exact changes' })
  await expect(dialog).toBeVisible()
  expect(preview).toEqual({ operation: 'joinDealTeam', input: { opportunityId: 'beta', domain: 'infra' } })
  expect(commits).toBe(0)
  await dialog.getByRole('button', { name: 'Cancel review' }).click()
  await expect(row.getByRole('button', { name: 'Add me', exact: true })).toBeEnabled()
  expect(commits).toBe(0)
  await row.getByRole('button', { name: 'Add me', exact: true }).click()
  await dialog.getByRole('textbox', { name: 'Review reason' }).fill('Sanitized explicit Deal Team approval')
  await dialog.getByRole('button', { name: 'Confirm selected changes' }).click()
  await expect(row.getByText('On deal team', { exact: true })).toBeVisible()
  await expect(row.getByRole('button', { name: 'Remove me', exact: true })).toBeEnabled()
  expect(commits).toBe(1)

  await row.getByRole('button', { name: 'Show milestones for Beta platform', exact: true }).click()
  const expanded = panel.getByRole('row', { name: 'Beta platform milestones', exact: true })
  await expect(expanded.getByText('Sanitized active milestone', { exact: true })).toBeVisible()
  await expect(expanded.getByText('Closed milestone must stay hidden', { exact: true })).toBeHidden()
  await expect(expanded.getByText('Cancelled milestone must stay hidden', { exact: true })).toBeHidden()
  await expect(expanded.getByText('Old milestone must stay hidden', { exact: true })).toBeHidden()
  await expanded.getByRole('button', { name: 'Add me to the team for Sanitized active milestone', exact: true }).click()
  await expect(dialog).toBeVisible()
  expect(preview).toEqual({ operation: 'joinMilestoneTeam', input: { opportunityId: 'beta', milestoneId: 'active', domain: 'infra' } })
  expect(commits).toBe(1)
  await dialog.getByRole('textbox', { name: 'Review reason' }).fill('Sanitized explicit milestone-team approval')
  await dialog.getByRole('button', { name: 'Confirm selected changes' }).click()
  await expect(expanded.getByRole('button', { name: 'Remove me from the team for Sanitized active milestone', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(commits).toBe(2)
  expect(reads).toEqual(['discoverOpportunities', 'listDiscoverableMilestones'])
})

for (const theme of ['default', 'dark', 'contrast'] as const) {
  test(`Discover filters and domain navigation fit Teams ${theme} at desktop and narrow widths`, async ({ page }) => {
    await discoveryFixture(page)
    const app = await embeddedTeams(page, 'content', theme)
    await app.getByRole('button', { name: 'Discover', exact: true }).click()
    const panel = app.getByRole('region', { name: 'Discover opportunities', exact: true })
    await expect(panel.getByRole('table', { name: 'Discovered opportunities' })).toBeVisible()
    for (const width of [1556, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: 844 })
      const tabs = panel.getByRole('tablist', { name: 'Solution Engineer domain' })
      await expect(tabs).toBeVisible()
      expect(await panel.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await panel.getByRole('button', { name: 'Customers equals all', exact: true }).click()
      const editor = panel.getByRole('dialog', { name: 'Customer filter', exact: true })
      await expect(editor).toBeVisible()
      const box = await editor.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.width).toBeLessThanOrEqual(width)
      expect(box!.x).toBeGreaterThanOrEqual(0)
      await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
    }
  })
}
