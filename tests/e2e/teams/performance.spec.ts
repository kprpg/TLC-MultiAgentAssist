import { expect, test } from '@playwright/test'
import { accountSchema } from '../../../packages/common/contracts/index.js'
import { post } from './helpers.js'

test('Portfolio waits for the whole workspace and uses one aggregate read without false empty states', async ({ page }) => {
  let release = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  const operations: string[] = []
  page.on('request', (request) => { if (request.url().includes('/operations/')) operations.push(request.url().split('/').at(-1)!) })
  await page.route('**/operations/getPortfolioWorkspace', async (route) => { await gate; await route.continue() })
  await page.goto('/')
  await expect(page.getByRole('status').filter({ hasText: 'Loading portfolio accounts, opportunities and milestones' })).toBeVisible()
  await expect(page.getByText('No eligible Portfolio opportunities. Use Discover to review your working set.', { exact: true })).toBeHidden()
  release()
  await expect(page.getByLabel('Customer account', { exact: true })).not.toHaveValue('')
  await expect(page.getByLabel('Opportunity', { exact: true })).not.toHaveValue('')
  await expect(page.locator('.milestone-card').first()).toBeVisible()
  expect(operations).toEqual(['getPortfolioWorkspace'])
})

test('search focus is local and a typed query makes one aggregate read instead of per-account requests', async ({ page, request }) => {
  const accounts = accountSchema.array().parse(await post(request, 'listAccounts', {}))
  const account = accounts[0]
  if (!account) throw new Error('No sanitized search account.')
  const operations: string[] = []
  page.on('request', (entry) => { if (entry.url().includes('/operations/')) operations.push(entry.url().split('/').at(-1)!) })
  await page.goto('/')
  await expect(page.getByLabel('Customer account', { exact: true })).not.toHaveValue('')
  operations.length = 0
  const search = page.getByRole('combobox', { name: 'Search accounts and opportunities', exact: true })
  await search.focus()
  await page.getByRole('heading', { name: 'Portfolio', exact: true }).click()
  await search.focus()
  expect(operations).toEqual([])
  await search.fill(account.name)
  const result = page.getByRole('listbox', { name: 'Search results', exact: true }).getByRole('option', { name: account.name, exact: true })
  await expect(result).toBeVisible()
  expect(operations).toEqual(['getPortfolioIndex'])
  await result.click()
  await expect(page.getByLabel('Customer account', { exact: true })).toHaveValue(account.id)
})

test('a failed fresh Portfolio read clears data and retries explicitly rather than returning stale success', async ({ page }) => {
  let denied = false
  await page.route('**/operations/getPortfolioWorkspace', (route) => denied
    ? route.fulfill({ status: 403, json: { error: 'source_access_denied' } }) : route.continue())
  await page.goto('/')
  await expect(page.getByLabel('Customer account', { exact: true })).not.toHaveValue('')
  denied = true
  await page.getByRole('button', { name: 'Refresh sources', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'source access denied' })).toBeVisible()
  await expect(page.getByLabel('Customer account', { exact: true }).locator('option')).toHaveCount(1)
  await expect(page.getByText('No customer accounts. Use Add customer to get started.', { exact: true })).toBeHidden()
  denied = false
  await page.getByRole('button', { name: 'Retry Portfolio', exact: true }).click()
  await expect(page.getByLabel('Customer account', { exact: true })).not.toHaveValue('')
  await expect(page.getByRole('alert').filter({ hasText: 'source access denied' })).toBeHidden()
})

test('a failed lazy workspace shows recovery guidance while leaving primary navigation usable', async ({ page }) => {
  await page.route('**/assets/workflows-*.js', (route) => route.abort())
  await page.goto('/')
  await expect(page.getByLabel('Customer account', { exact: true })).not.toHaveValue('')
  await page.getByRole('button', { name: 'Plays', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Workspace controls are unavailable' })).toBeVisible()
  await page.getByRole('button', { name: 'Portfolio', exact: true }).click()
  await expect(page.getByLabel('Customer account', { exact: true })).toBeVisible()
})
