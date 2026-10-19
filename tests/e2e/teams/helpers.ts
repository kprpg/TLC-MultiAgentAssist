import { expect, type APIRequestContext, type Page } from '@playwright/test'

export async function post(request: APIRequestContext, operation: string, input: unknown) {
  const response = await request.post(`/api/teams/operations/${operation}`, { data: input })
  expect(response.ok()).toBeTruthy()
  return response.json()
}
export async function openUtility(page: Page, name: string) {
  await page.getByText('Tools', { exact: true }).click()
  await page.getByRole('button', { name, exact: true }).click()
}
export async function chooseOpportunity(page: Page, request: APIRequestContext, transcriptRequired = false) {
  const accounts: Array<{ id: string; name: string }> = await post(request, 'listAccounts', {})
  for (const account of accounts) {
    const opportunities: Array<{ id: string; name: string }> = await post(request, 'listOpportunities', { accountId: account.id })
    for (const opportunity of opportunities) {
      const sources = transcriptRequired
        ? await (await request.post('/api/teams/meetings/sources', { data: { opportunityId: opportunity.id } })).json() as unknown[] : [true]
      if (!sources.length) continue
      await page.getByRole('button', { name: 'Portfolio', exact: true }).click()
      await page.getByLabel('Customer account', { exact: true }).selectOption(account.id)
      await page.getByLabel('Opportunity', { exact: true }).selectOption(opportunity.id)
      await expect(page.getByRole('heading', { name: opportunity.name, exact: true })).toBeVisible()
      return { account, opportunity }
    }
  }
  throw new Error('The canonical sample dataset has no eligible opportunity.')
}
