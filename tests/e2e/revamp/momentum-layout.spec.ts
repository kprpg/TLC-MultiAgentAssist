import { expect, test } from '@playwright/test'
import { SharedMomentumFocusHost } from '../../../packages/orchestrator/momentum-focus/host.js'
import { createMomentumFixture, momentumSampleNow } from '../../../packages/common/fixtures/momentum-focus.js'
import { openMomentum } from '../momentum-journey.js'

for (const theme of ['light', 'dark']) {
    test(`Momentum adopts the Stage review ${theme} palette and compact section navigation`, async ({ page }) => {
        await page.setViewportSize({ width: 1536, height: 960 })
        let reads = 0
        page.on('request', (request) => { if (request.url().endsWith('/api/momentum-focus')) reads++ })
        await page.goto(`/?scoutTheme=${theme}`)
        await page.getByRole('button', { name: 'Dashboards', exact: true }).click()
        await page.getByRole('tab', { name: 'Stage and Pipeline Review', exact: true }).click()
        const reference = page.getByRole('region', { name: 'Stage and Pipeline Review', exact: true })
        await expect(reference.getByRole('heading', { level: 1 })).toBeVisible()
        const palette = await reference.evaluate((node) => {
            const style = getComputedStyle(node)
            const heading = getComputedStyle(node.querySelector('h1')!)
            return { background: style.backgroundColor, color: style.color, font: style.fontSize, heading: heading.color, headingSize: heading.fontSize }
        })
        await page.getByRole('tab', { name: 'Momentum & Focus', exact: true }).click()
        const pane = page.getByRole('region', { name: 'Momentum & Focus', exact: true })
        const queue = pane.getByRole('table', { name: 'Momentum priority queue', exact: true })
        await expect(queue).toBeVisible()
        await expect(pane).toHaveCSS('background-color', palette.background)
        await expect(pane).toHaveCSS('color', palette.color)
        await expect(pane).toHaveCSS('font-size', palette.font)
        await expect(pane.getByRole('heading', { level: 1 })).toHaveCSS('color', palette.heading)
        await expect(pane.getByRole('heading', { level: 1 })).toHaveCSS('font-size', palette.headingSize)
        const sections = pane.getByRole('tablist', { name: 'Momentum sections', exact: true })
        const before = reads
        await sections.getByRole('tab', { name: /^Traction & signals/ }).click()
        await expect(pane.getByRole('img', { name: 'Progress versus signals', exact: true })).toBeVisible()
        await sections.getByRole('tab', { name: /^Milestones & deadlines/ }).click()
        await expect(pane.getByRole('table', { name: 'Deadline distribution table', exact: true })).toBeVisible()
        await sections.getByRole('tab', { name: /^Sources & financials/ }).click()
        await expect(pane.getByRole('table', { name: 'Financial groups table', exact: true })).toBeVisible()
        await expect(queue).toHaveCount(0)
        await sections.getByRole('tab', { name: /^Priorities/ }).click()
        await expect(queue).toBeVisible()
        expect(reads).toBe(before)
        await expect(pane.getByLabel('Customer industry', { exact: true })).toHaveValue('hls')
    })
}

test('Momentum keeps long rows compact, native currencies intact and narrow filters within the viewport', async ({ page }) => {
    const host = new SharedMomentumFocusHost({
        now: () => new Date(momentumSampleNow),
        collect: async (scope, industry) => {
            const data = createMomentumFixture(industry)
            data.scope = scope
            for (const row of data.records) {
                row.name = 'Synthetic long technical milestone and decision checkpoint '.repeat(5)
                row.accountName = 'Synthetic Healthcare Group With A Long Display Name '.repeat(4)
                if (row.id === 'euro' || row.id === 'euro-proof') row.value.currency = 'NZD'
            }
            return data
        }
    })
    await page.route('**/api/momentum-focus', async (route) => route.fulfill({
        contentType: 'application/json', body: JSON.stringify(await host.invoke(route.request().postDataJSON()))
    }))
    await page.setViewportSize({ width: 1536, height: 960 })
    await page.goto('/')
    await openMomentum(page)
    const pane = page.getByRole('region', { name: 'Momentum & Focus', exact: true })
    const queue = pane.getByRole('table', { name: 'Momentum priority queue', exact: true })
    const heights = await queue.locator('tbody tr').evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height))
    expect(Math.max(...heights)).toBeLessThanOrEqual(112)
    const link = queue.locator('.momentum-entity-link').first()
    await expect(link).toHaveCSS('padding-top', '0px')
    await expect(link).toHaveCSS('border-top-width', '0px')
    expect((await link.getAttribute('title'))!.length).toBeGreaterThan(200)
    const sections = pane.getByRole('tablist', { name: 'Momentum sections', exact: true })
    await sections.getByRole('tab', { name: /^Sources & financials/ }).click()
    const financial = pane.getByRole('table', { name: 'Financial groups table', exact: true })
    await expect(financial.getByRole('cell', { name: 'NZD', exact: true })).toHaveCount(2)
    await expect(financial).toContainText('80,000')
    await expect(financial).toContainText('2,000')
    await sections.getByRole('tab', { name: /^Priorities/ }).click()
    await page.setViewportSize({ width: 1024, height: 640 })
    await queue.locator('tbody tr').first().scrollIntoViewIfNeeded()
    await expect(queue.locator('tbody tr').first()).toBeInViewport()
    await page.setViewportSize({ width: 420, height: 900 })
    expect(await pane.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
    const stages = pane.getByRole('button', { name: 'All stages', exact: true })
    await stages.click()
    const popup = pane.getByRole('group', { name: 'Parent opportunity stage', exact: true })
    await expect(popup).toBeVisible()
    const bounds = await popup.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(8)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(412)
    await popup.getByRole('checkbox').first().focus()
    await popup.press('Escape')
    await expect(popup).toHaveCount(0)
    await expect(stages).toBeFocused()
})
