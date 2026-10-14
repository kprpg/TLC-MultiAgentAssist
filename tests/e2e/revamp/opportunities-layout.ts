import { expect, type Page } from '@playwright/test'

export async function expectOpportunitiesToFillCollapsedWorkspace(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('region', { name: 'Accounts blade' }).getByRole('button', { name: /Contoso Energy/ }).click()

  const opportunities = page.getByRole('region', { name: 'Opportunities blade' })
  await opportunities.getByRole('button', { name: /^Grid operations modernization / }).click()
  const initialWidth = (await opportunities.boundingBox())?.width ?? 0

  await page.getByRole('button', { name: 'Collapse Accounts blade header' }).click()
  await page.getByRole('button', { name: 'Collapse Guidance pane' }).click()
  await page.getByRole('button', { name: 'Collapse Next best actions blade header' }).click()

  await expect(page.getByRole('button', { name: 'Expand Accounts blade header' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Expand Guidance pane' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Expand Next best actions blade header' })).toBeVisible()

  const workspace = page.locator('.workspace')
  await expect.poll(async () => {
    const workspaceWidth = (await workspace.boundingBox())?.width ?? 0
    const opportunitiesWidth = (await opportunities.boundingBox())?.width ?? 0
    return opportunitiesWidth / workspaceWidth
  }).toBeGreaterThan(0.75)
  await expect.poll(async () => (await opportunities.boundingBox())?.width ?? 0).toBeGreaterThan(initialWidth + 500)
}
