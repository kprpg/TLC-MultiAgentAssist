import { expect, test } from '@playwright/test'
import { membershipView } from '../workflow-membership-fixtures.js'

test('Teams filters result rows and queue items, restores All, and explains disabled nonmember actions', async ({ page }) => {
  let starts = 0
  let modelCalls = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/operations/workflows.start')) starts++
    if (/\/operations\/runAgentTask/.test(request.url())) modelCalls++
  })
  await page.route('**/api/teams/operations/workflows.view', (route) => {
    const request = route.request().postDataJSON() as { filter: 'all' | 'mine'; runId: string }
    return route.fulfill({ json: membershipView(request.filter, request.runId) })
  })
  await page.goto('/?view=plays')
  await page.getByLabel('Workflow', { exact: true }).selectOption('WF-001')
  await page.getByRole('button', { name: 'Run workflow', exact: true }).click()
  const filter = page.getByLabel('Filter Play results')
  await expect(filter).toHaveValue('all')
  const row = (title: string) => page.locator('.play-result .record-list > li').filter({ hasText: title })
  await expect(row('Review member queue item').getByRole('button', { name: 'Prepare guidance' })).toBeEnabled()
  const disabled = row('Review nonmember queue item').getByRole('button', { name: 'Prepare guidance' })
  await expect(disabled).toBeDisabled()
  await disabled.locator('..').hover()
  await expect(page.getByRole('tooltip').filter({ hasText: /not a member/ })).toBeVisible()
  await filter.selectOption('mine')
  await expect(page.getByText('1 of 2 items', { exact: true })).toBeVisible()
  await expect(row('Review nonmember queue item')).toHaveCount(0)
  await expect(page.getByText('Nonmember result record', { exact: true })).toHaveCount(0)
  await filter.selectOption('all')
  await expect(page.getByText('2 of 2 items', { exact: true })).toBeVisible()
  await expect(row('Review nonmember queue item')).toBeVisible()
  await expect(page.getByText('Nonmember result record', { exact: true })).toBeVisible()
  expect(starts).toBe(1)
  expect(modelCalls).toBe(0)
})
