import { expect, test } from '@playwright/test'

test('Teams exposes SE Reporting as a sibling dashboard over the shared sample service', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Dashboards', exact: true }).click()
    await page.getByRole('tab', { name: 'SE Reporting Dashboard', exact: true }).click()
    const frame = page.frameLocator('iframe[title="SE monthly report"]')
    await expect(frame.locator('.kpi')).toHaveCount(5)
    await expect(frame.getByRole('heading', { name: 'SE Reporting Dashboard', exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'Seller Dashboard', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Seller Dashboard', exact: true })).toBeVisible()
})
