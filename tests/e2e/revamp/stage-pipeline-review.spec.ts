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

test('Stage and Pipeline Review manager scope shows direct reports, read-only owners and refreshes without losing the view', async ({ page }) => {
    const errors: Error[] = []
    page.on('pageerror', (error) => errors.push(error))
    await page.setViewportSize({ width: 1600, height: 1100 })
    await page.goto('/')
    await openStagePipelineReview(page)

    const scope = page.getByRole('radiogroup', { name: 'Portfolio scope' })
    await expect(scope.getByRole('radio', { name: /My portfolio/ })).toBeChecked()
    await expect(page.getByRole('group', { name: 'Direct reports in view' })).toHaveCount(0)
    await expect(page.getByRole('columnheader', { name: 'Sort Opportunities by Owner' })).toHaveCount(0)

    await scope.locator('label', { hasText: 'My direct reports' }).click()
    const reports = page.getByRole('group', { name: 'Direct reports in view' })
    await expect(reports).toContainText('Viewing 3 of 3 direct reports')
    await expect(page.getByRole('table', { name: 'Opportunities' }).getByRole('columnheader', { name: 'Sort Opportunities by Owner' })).toBeVisible()
    await expect(page.getByRole('table', { name: 'Opportunities' }).locator('tbody tr').first()).toContainText('read-only')

    await reports.getByRole('checkbox', { name: 'Sample Report A' }).uncheck()
    await expect(reports).toContainText('Viewing 2 of 3 direct reports')
    await expect(page.getByRole('table', { name: 'Opportunities' })).not.toContainText('Sample Report A')

    await page.getByRole('region', { name: 'Stage and Pipeline Review' }).getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(reports).toContainText('Viewing 2 of 3 direct reports')

    await scope.locator('label', { hasText: 'Both' }).click()
    await expect(reports).toContainText('Viewing 3 of 3 direct reports')
    await scope.locator('label', { hasText: 'My portfolio' }).click()
    await expect(page.getByRole('group', { name: 'Direct reports in view' })).toHaveCount(0)
    await expect(page.getByRole('columnheader', { name: 'Sort Opportunities by Owner' })).toHaveCount(0)
    expect(errors).toEqual([])
})

test('Stage and Pipeline Review writes a forecast comment and a milestone change through a reviewed dialog (sample simulation)', async ({ page }) => {
    const errors: Error[] = []
    page.on('pageerror', (error) => errors.push(error))
    await page.setViewportSize({ width: 1600, height: 1100 })
    await page.goto('/')
    await openStagePipelineReview(page)

    const table = page.getByRole('table', { name: 'Opportunities' })
    const first = table.locator('tbody tr').first()
    await first.getByRole('button', { name: /^Add forecast comment to / }).click()
    const dialog = page.getByRole('dialog', { name: 'Add forecast comment' })
    await expect(dialog.getByRole('button', { name: 'Save to MSX' })).toBeDisabled()
    await dialog.getByLabel('New update').fill('Customer confirmed the pilot scope')
    await expect(dialog.getByLabel('Review the resulting comment')).toContainText('21/Oct - Customer confirmed the pilot scope')
    await dialog.getByRole('button', { name: 'Save to MSX' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(table).toContainText('21/Oct - Customer confirmed the pilot scope')

    await page.getByRole('tab', { name: /Milestones/ }).click()
    await page.getByRole('button', { name: /^Update milestone / }).first().click()
    const milestone = page.getByRole('dialog', { name: 'Update milestone' })
    await milestone.getByLabel(/^Status/).selectOption('At Risk')
    await expect(milestone.getByRole('button', { name: 'Save to MSX' })).toBeDisabled()
    await milestone.getByLabel(/^Reason/).fill('Customer budget review')
    await expect(milestone.getByLabel('Review the changes')).toContainText('At Risk')
    await milestone.getByRole('button', { name: 'Save to MSX' }).click()
    await expect(milestone).toHaveCount(0)
    await expect(page.getByRole('table', { name: 'Milestones' })).toContainText('Customer budget review')
    expect(errors).toEqual([])
})

test('Stage and Pipeline Review keeps report-owned rows read-only', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 })
    await page.goto('/')
    await openStagePipelineReview(page)
    await page.getByRole('radiogroup', { name: 'Portfolio scope' }).locator('label', { hasText: 'My direct reports' }).click()
    const table = page.getByRole('table', { name: 'Opportunities' })
    await expect(table.locator('tbody tr').first()).toContainText('read-only')
    await expect(table.getByRole('button', { name: /^Add forecast comment to / })).toHaveCount(0)
})