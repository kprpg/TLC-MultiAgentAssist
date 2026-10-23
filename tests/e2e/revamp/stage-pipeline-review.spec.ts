import { expect, test, type Page } from '@playwright/test'

function escapeRegExpLiteral(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function openStagePipelineReview(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Dashboards', exact: true }).click()
    await page.getByRole('tab', { name: 'Stage and Pipeline Review', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Stage and Pipeline Review', level: 1 })).toBeVisible()
}

test('Stage and Pipeline Review is a Dashboards child tab with working scope, stage, alert and milestone filters', async ({ page }) => {
    const errors: Error[] = []
    page.on('pageerror', (error) => errors.push(error))
    await page.setViewportSize({ width: 1600, height: 1100 })
    await page.goto('/')
    await openStagePipelineReview(page)

    await expect(page.getByRole('radio', { name: /Azure only/ })).toBeChecked()
    await expect(page.getByRole('radio', { name: /Exclude Inbound/ })).toBeChecked()
    await expect(page.getByLabel('Active filters')).toContainText('Solution: Cloud and AI Platforms')
    await expect(page.getByLabel('Active filters')).toContainText('Opportunity: Excluding Inbound')
    for (const name of ['Opportunities', 'Actions', 'Consumption', 'MACC & Commits', 'Milestones']) {
        await expect(page.getByRole('tab', { name: new RegExp(escapeRegExpLiteral(name)) })).toBeVisible()
    }
    await expect(page.getByRole('region', { name: 'ACR Actuals and Outlook' })).toBeVisible()

    await page.getByRole('button', { name: /All stages/ }).click()
    await page.getByRole('checkbox', { name: /Inspire & Design/ }).check()
    await page.getByRole('checkbox', { name: /Empower & Achieve/ }).check()
    await expect(page.getByRole('button', { name: /2 stages/ })).toBeVisible()
    await expect(page.getByLabel('Active filters')).toContainText('Stage: Inspire & Design')
    await page.keyboard.press('Escape')

    await page.locator('label', { hasText: 'Microsoft Services' }).click()
    await expect(page.getByRole('radio', { name: /Microsoft Services/ })).toBeChecked()
    await expect(page.getByLabel('Active filters')).toContainText('Solution: Microsoft Services')
    await page.getByRole('button', { name: 'Reset' }).click()
    await expect(page.getByRole('radio', { name: /Azure only/ })).toBeChecked()

    await page.getByRole('button', { name: /Overdue close/ }).first().click()
    await expect(page.getByLabel('Active filters')).toContainText('Alert: Overdue close')
    await page.getByRole('button', { name: 'Reset' }).click()

    await page.getByRole('tab', { name: /Milestones/ }).click()
    await expect(page.getByRole('region', { name: 'Milestones by status' })).toBeVisible()
    await page.getByRole('button', { name: 'Filter milestones by Completed' }).click()
    await expect(page.getByRole('table', { name: 'Milestones' }).locator('tbody tr').first()).toContainText('Completed')
    await page.getByRole('button', { name: 'Clear milestone filters' }).click()

    expect(errors).toEqual([])
})
