import { expect, test } from '@playwright/test'
import { accountSchema, discoverySnapshotSchema, opportunitySchema } from '../../../packages/common/contracts/index.js'
import { embeddedTeams, post } from './helpers.js'

test('a sandboxed Teams customer switch offers an in-app discard choice and preserves edits on cancel', async ({ page, request }) => {
  const accounts = accountSchema.array().parse(await post(request, 'listAccounts', {}))
  const first = accounts[0]!
  const next = accounts.find((item) => item.id !== first.id)!
  const opportunities = opportunitySchema.array().parse(await post(request, 'listOpportunities', { accountId: next.id }))
  const app = await embeddedTeams(page, 'content', 'default', '1.2484.12345', true)
  const customer = app.getByLabel('Customer account', { exact: true })
  await expect(customer).toHaveValue(first.id)
  await app.getByText('Opportunity notes and reviewed updates', { exact: true }).click()
  const notes = app.getByLabel('Opportunity notes', { exact: true })
  await notes.fill('Unsent sanitized customer-switch draft')
  await customer.selectOption(next.id)
  const dialog = app.getByRole('dialog', { name: 'Discard unsent edits?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Keep editing' }).click()
  await expect(customer).toHaveValue(first.id)
  await expect(notes).toHaveValue('Unsent sanitized customer-switch draft')
  await customer.selectOption(next.id)
  await dialog.getByRole('button', { name: 'Discard edits and continue' }).click()
  await expect(customer).toHaveValue(next.id)
  await expect(app.getByLabel('Opportunity', { exact: true })).toHaveValue(opportunities[0]!.id)
  await expect(app.getByRole('heading', { name: opportunities[0]!.name, exact: true })).toBeVisible()
})

test('Discover waits for delayed results instead of showing empty data and makes only its own source read', async ({ page, request }) => {
  const results = discoverySnapshotSchema.parse(await post(request, 'getDiscoverySnapshot', { contractVersion: '1.0' }))
  const infra = results.opportunities.filter((item) => item.domain === 'infra')
  expect(infra.length).toBeGreaterThan(0)
  let release = () => {}
  const blocked = new Promise<void>((resolve) => { release = resolve })
  const reads: string[] = []
  page.on('request', (entry) => {
    if (entry.url().includes('/operations/')) reads.push(entry.url().split('/').at(-1)!)
  })
  await page.route('**/api/teams/operations/getDiscoverySnapshot', async (route) => {
    await blocked
    await route.fulfill({ json: results })
  })
  await page.goto('/?view=discover')
  await expect(page.getByRole('status').filter({ hasText: 'Loading Discover opportunities' })).toBeVisible()
  await expect(page.getByText('No eligible opportunities for this source scope and domain.', { exact: true })).toBeHidden()
  release()
  await expect(page.getByText(infra[0]!.name, { exact: true })).toBeVisible()
  expect(reads).toEqual(['getDiscoverySnapshot'])
})

test('Discover displays source failures with retry rather than falsely reporting an empty working set', async ({ page, request }) => {
  const results = await post(request, 'getDiscoverySnapshot', { contractVersion: '1.0' })
  let attempts = 0
  await page.route('**/api/teams/operations/getDiscoverySnapshot', async (route) => {
    attempts++
    await route.fulfill(attempts <= 3 ? { status: 503, json: { error: 'source_temporarily_unavailable' } } : { json: results })
  })
  await page.goto('/?view=discover')
  await expect(page.getByRole('alert').filter({ hasText: 'source temporarily unavailable' })).toBeVisible()
  await expect(page.getByText('No eligible opportunities for this source scope and domain.', { exact: true })).toBeHidden()
  await page.getByRole('button', { name: 'Refresh Discover', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'source temporarily unavailable' })).toBeHidden()
  await expect(page.getByRole('table', { name: 'Discovered opportunities', exact: true })).toBeVisible()
  expect(attempts).toBe(4)
})
