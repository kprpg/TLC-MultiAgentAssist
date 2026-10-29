import { expect, test, type Route } from '@playwright/test'
import { captureTypography, expectFontReduction } from '../typography.js'
import { embeddedTeams } from './helpers.js'

for (const theme of ['default', 'dark', 'contrast']) test(`Teams font scale follows the ${theme} theme and responsive headings`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 })
    const app = await embeddedTeams(page, 'content', theme)
    const shell = await captureTypography(test.info(), {
        provider: app.locator('.fui-FluentProvider'),
        shell: app.locator('.teams-shell'),
        brand: app.locator('.brand'),
        tab: app.getByRole('button', { name: 'Portfolio', exact: true }),
        footer: app.locator('.teams-footer'),
        input: app.getByLabel('Customer account', { exact: true }),
        icon: app.locator('.layout-control svg').first()
    }, 'shell')
    expectFontReduction(shell, { provider: 14, shell: 13, brand: 15, tab: 13, footer: 11, input: 13 })
    expect(shell['icon']).toMatchObject({ width: 20, height: 20 })
    expect(shell['tab']?.padding).toBe('8px 12px')
    expect(shell['footer']?.padding).toBe('12px 16px')
    if (theme === 'default') await page.screenshot({ path: test.info().outputPath('portfolio.png') })
    await app.getByText('Tools', { exact: true }).click()
    await app.getByRole('button', { name: 'My work', exact: true }).click()
    for (const width of [1600, 800, 400]) {
        await page.setViewportSize({ width, height: 1000 })
        const heading = await captureTypography(test.info(), { heading: app.locator('.hero > h1') }, `heading-${width}`)
        expectFontReduction(heading, { heading: Math.max(28, Math.min(42, width * 0.04)) })
    }
    await app.getByRole('button', { name: 'Dashboards', exact: true }).click()
    await app.getByRole('tab', { name: 'SE Reporting Dashboard', exact: true }).click()
    const report = app.frameLocator('iframe[title="SE monthly report"]')
    const reportFonts = await captureTypography(test.info(), {
        body: report.locator('body'),
        heading: report.getByRole('heading', { name: 'SE Reporting Dashboard', exact: true }),
        kpi: report.locator('.kpi strong').first()
    }, 'report')
    expectFontReduction(reportFonts, { body: 14, heading: 28, kpi: 27 })
})

for (const frame of ['settings', 'sidePanel'] as const) test(`Teams font scale applies inside the ${frame} frame`, async ({ page }) => {
    const app = await embeddedTeams(page, frame, 'dark')
    const fonts = await captureTypography(test.info(), {
        shell: app.locator('.teams-shell'),
        heading: app.getByRole('heading', { name: frame === 'settings' ? 'Configure a Teams context' : 'Meeting preparation', exact: true }),
        footer: app.locator('.teams-footer')
    })
    expectFontReduction(fonts, { shell: 13, heading: frame === 'settings' ? 26 : 15, footer: 11 })
})

test('Teams font scale covers initialization before the workspace is ready', async ({ page }) => {
    const delayed: Route[] = []
    await page.route('**/api/teams/session', (route) => { delayed.push(route) })
    try {
        await page.goto('/')
        const fonts = await captureTypography(test.info(), {
            heading: page.locator('.signin-panel h1'),
            status: page.locator('.signin-panel > p').first()
        })
        expectFontReduction(fonts, { heading: 26, status: 14 })
    } finally {
        await Promise.all(delayed.map((route) => route.continue()))
    }
    await expect(page.locator('.teams-shell')).toBeVisible()
})
