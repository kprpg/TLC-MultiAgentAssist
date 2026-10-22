import { expect, test } from '@playwright/test'
import { mcemStages } from '../../../apps/shared/mcem-stages.js'
import { post } from './helpers.js'
import { accountSchema, opportunitySchema, type Account, type Opportunity } from '../../../packages/common/contracts/index.js'
import { workflowDefinitionSchema } from '../../../packages/common/contracts/workflows.js'

test('MCEM shows the shared five-stage account board, preserves selection and evaluates only on explicit request', async ({ page, request }) => {
  const accounts = accountSchema.array().parse(await post(request, 'listAccounts', {}))
  let scope: { account: Account; opportunities: Opportunity[] } | undefined
  for (const account of accounts) {
    const opportunities = opportunitySchema.array().parse(await post(request, 'listOpportunities', { accountId: account.id }))
    if (opportunities.length > 1) { scope = { account, opportunities }; break }
  }
  if (!scope) throw new Error('The sample fixture requires an account with multiple opportunities.')
  const first = scope.opportunities[0]!
  const second = scope.opportunities[1]!
  let evaluations = 0
  page.on('request', (entry) => { if (entry.url().endsWith('/operations/runMcemCoach')) evaluations++ })
  await page.goto('/')
  await page.getByLabel('Customer account', { exact: true }).selectOption(scope.account.id)
  await page.getByLabel('Opportunity', { exact: true }).selectOption(first.id)
  await page.getByRole('tab', { name: 'MCEM Stages', exact: true }).click()
  const board = page.getByRole('region', { name: 'MCEM Stage Management', exact: true })
  await expect(board).toBeVisible()
  for (const stage of mcemStages) {
    const column = board.getByRole('region', { name: `Stage ${stage.id}: ${stage.name}`, exact: true })
    await expect(column).toBeAttached()
    await expect(column.getByText(stage.role, { exact: true })).toBeAttached()
    for (const opportunity of scope.opportunities.filter((item) => item.recordedStage === stage.id)) {
      await expect(column.getByRole('button', { name: opportunity.name, exact: true })).toBeAttached()
    }
  }
  expect(evaluations).toBe(0)
  await board.getByRole('button', { name: second.name, exact: true }).click()
  await expect(page.getByRole('heading', { name: second.name, exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'MCEM Stages', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(board.getByRole('button', { name: second.name, exact: true })).toHaveAttribute('aria-pressed', 'true')
  const panel = page.getByRole('tabpanel', { name: 'MCEM Stages', exact: true })
  await panel.getByRole('button', { name: 'Run MCEM Coach', exact: true }).click()
  await expect(panel.getByText('Evidence-based stage', { exact: false })).toBeVisible()
  expect(evaluations).toBe(1)
  await expect(panel.getByRole('button', { name: 'Review MCEM stage change', exact: true })).toBeDisabled()
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
})

test('Plays shows startup progress while a slow start is pending and does not submit twice', async ({ page }) => {
  let release = () => {}
  const blocked = new Promise<void>((resolve) => { release = resolve })
  let starts = 0
  await page.route('**/api/teams/operations/workflows.start', async (route) => {
    starts++
    await blocked
    await route.continue()
  })
  await page.goto('/?view=plays')
  await expect(page.getByLabel('Workflow', { exact: true })).not.toHaveValue('')
  await page.getByRole('button', { name: 'Run workflow', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Starting workflow...', exact: true })).toBeDisabled()
  await expect(page.getByRole('status').filter({ hasText: 'verifying your current source scope' })).toBeVisible()
  expect(starts).toBe(1)
  release()
  await expect(page.getByTestId('workflow-status')).toContainText('completed')
  await expect(page.getByRole('region', { name: 'Play result', exact: true })).toBeVisible()
  expect(starts).toBe(1)
})

test('Plays distinguishes a delayed or failed catalog from an empty catalog and retries explicitly', async ({ page, request }) => {
  const definitions = workflowDefinitionSchema.array().parse(await post(request, 'workflows.list', { contractVersion: '1.0', scope: 'portfolio' }))
  let release = () => {}
  const blocked = new Promise<void>((resolve) => { release = resolve })
  let attempts = 0
  await page.route('**/api/teams/operations/workflows.list', async (route) => {
    attempts++
    if (attempts === 1) { await blocked; await route.fulfill({ status: 503, json: { error: 'catalog_temporarily_unavailable' } }) }
    else await route.fulfill({ json: definitions })
  })
  await page.goto('/?view=plays')
  await expect(page.getByRole('status').filter({ hasText: 'Loading Play catalog' })).toBeVisible()
  await expect(page.getByText('No Plays are available for this scope and filter.', { exact: true })).toBeHidden()
  release()
  await expect(page.getByRole('alert').filter({ hasText: 'catalog temporarily unavailable' })).toBeVisible()
  await expect(page.getByText('No Plays are available for this scope and filter.', { exact: true })).toBeHidden()
  await page.getByRole('button', { name: 'Retry Play catalog', exact: true }).click()
  await expect(page.getByLabel('Workflow', { exact: true })).toHaveValue(definitions[0]!.id)
  await expect(page.getByRole('button', { name: 'Run workflow', exact: true })).toBeEnabled()
  expect(attempts).toBe(2)
})

test('Plays does not report empty history when its history read fails and supports retry', async ({ page }) => {
  let attempts = 0
  await page.route('**/api/teams/operations/workflows.history', async (route) => {
    attempts++
    await route.fulfill(attempts === 1
      ? { status: 503, json: { error: 'history_temporarily_unavailable' } }
      : { json: [] })
  })
  await page.goto('/?view=plays')
  const history = page.getByRole('region', { name: 'Play history', exact: true })
  await expect(history.getByRole('alert')).toContainText('history temporarily unavailable')
  await expect(history.getByText('No runs in this source scope yet.', { exact: true })).toBeHidden()
  await history.getByRole('button', { name: 'Retry recent runs', exact: true }).click()
  await expect(history.getByText('No runs in this source scope yet.', { exact: true })).toBeVisible()
  expect(attempts).toBe(2)
})

test('a rejected workflow start releases the busy state and shows the error rather than a completed result', async ({ page }) => {
  await page.route('**/api/teams/operations/workflows.start', (route) => route.fulfill({
    status: 503, json: { error: 'workflow_source_unavailable', correlationId: 'sanitized-workflow-reference' }
  }))
  await page.goto('/?view=plays')
  await page.getByRole('button', { name: 'Run workflow', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'workflow source unavailable' })).toContainText('sanitized-workflow-reference')
  await expect(page.getByRole('button', { name: 'Run workflow', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Starting workflow...', exact: true })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Play result', exact: true })).toHaveCount(0)
})
