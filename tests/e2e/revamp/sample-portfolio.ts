import { expect, type Page } from '@playwright/test'

const samplePortfolio = [
  { account: 'Contoso Energy', opportunity: 'Grid operations modernization' },
  { account: 'Fabrikam Retail', opportunity: 'AI-assisted customer service' },
  { account: 'Zava Inc.', opportunity: 'Zava AI platform foundation' },
  { account: 'Adventure Works Cycles', opportunity: 'Adventure Works commerce replatform' },
  { account: 'Fourth Coffee', opportunity: 'Customer loyalty Copilot' },
  { account: 'Tailspin Toys', opportunity: 'Global ecommerce expansion' },
  { account: 'Wide World Importers', opportunity: 'Supply chain control tower - ready to advance' },
  { account: 'Woodgrove Bank', opportunity: 'AI fraud prevention expansion' }
] as const

export async function expectCompleteSamplePortfolio(page: Page): Promise<void> {
  const accountsBlade = page.getByRole('region', { name: 'Accounts blade' })
  await expect(accountsBlade.locator('.account-row')).toHaveCount(samplePortfolio.length)

  for (const sample of samplePortfolio) {
    await accountsBlade.getByRole('button', { name: new RegExp(sample.account) }).click()
    const opportunities = page.getByRole('table', { name: `${sample.account} opportunities` })
    await expect(opportunities.getByRole('row')).not.toHaveCount(1)
    await expect(opportunities.getByRole('columnheader', { name: 'Opportunity Intent' })).toBeVisible()
    await expect(opportunities.getByRole('cell').filter({ hasText: /Billed|Consumption/ }).first()).toBeVisible()

    await opportunities.getByRole('button', { name: new RegExp(`^${sample.opportunity} `) }).click()
    const milestones = page.getByRole('region', { name: `${sample.opportunity} milestones` })
    await expect(milestones.getByRole('row')).not.toHaveCount(1)

    const workbench = page.getByRole('region', { name: 'Opportunity workbench' })
    await expect(workbench.getByText('Recorded in MSX', { exact: true })).toBeVisible()
    await expect(workbench.getByText('Evidence supports', { exact: true })).toBeVisible()
    await expect(workbench.locator('.criterion-row')).not.toHaveCount(0)
  }

  const blade = await page.getByRole('region', { name: 'Opportunities blade' }).boundingBox()
  const actions = await page.getByRole('region', { name: 'Opportunities blade' }).locator('.blade-header-actions').boundingBox()
  if (!blade || !actions) throw new Error('The Opportunity header or its actions are not visible.')
  expect(actions.x + actions.width).toBeLessThanOrEqual(blade.x + blade.width + 1)

  const collapse = page.getByRole('button', { name: 'Collapse Guidance pane' })
  await expect(collapse).toBeVisible()
  await collapse.click()
  const expand = page.getByRole('button', { name: 'Expand Guidance pane' })
  await expect(expand).toBeVisible()
  await expand.click()
  await expect(collapse).toBeVisible()
}
