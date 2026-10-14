import { expect, type Page } from '@playwright/test'

export async function expectOpportunityAndMilestoneRemoval(page: Page): Promise<void> {
  await page.locator('.rail-button[title="Discover opportunities"]').click()

  const discovery = page.getByRole('region', { name: 'Discover opportunities' })
  const opportunityRow = discovery.getByRole('row').filter({ hasText: 'Hybrid networking modernization' })
  const dealTeamAdd = opportunityRow.getByRole('button', { name: 'Add me', exact: true })
  await expect(dealTeamAdd).toBeVisible()
  await dealTeamAdd.click()

  const dealTeamRemove = opportunityRow.getByRole('button', { name: 'Remove me', exact: true })
  await expect(dealTeamRemove).toBeVisible()
  await dealTeamRemove.click()
  await page.getByRole('dialog', { name: 'Remove from Deal Team' }).getByRole('button', { name: 'Remove membership' }).click()
  await expect(dealTeamAdd).toBeVisible()

  await opportunityRow.getByRole('button', { name: 'Show milestones for Hybrid networking modernization' }).click()
  const milestonesRow = discovery.getByRole('row', { name: 'Hybrid networking modernization milestones' })
  const milestoneAdd = milestonesRow.getByRole('button', { name: 'Add me to the team for Customer outcome validation' })
  await expect(milestoneAdd).toHaveAttribute('aria-pressed', 'false')
  await milestoneAdd.click()

  const milestoneRemove = milestonesRow.getByRole('button', { name: 'Remove me from the team for Customer outcome validation' })
  await expect(milestoneRemove).toHaveAttribute('aria-pressed', 'true')
  await milestoneRemove.click()
  await page.getByRole('dialog', { name: 'Remove from milestone team' }).getByRole('button', { name: 'Remove membership' }).click()
  await expect(milestoneAdd).toHaveAttribute('aria-pressed', 'false')
}
