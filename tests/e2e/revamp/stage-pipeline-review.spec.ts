import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { createSampleStagePipelineReview } from '../../../packages/common/fixtures/stage-pipeline-review.js'

function escapeRegExpLiteral(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function openStagePipelineReview(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Dashboards', exact: true }).click()
    await page.getByRole('tab', { name: 'Stage and Pipeline Review', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Stage and Pipeline Review', level: 1 })).toBeVisible()
}

interface PipelineThemeColors {
    background: string
    surface: string
    text: string
    accent: string
    brand: string
    onBrand: string
    heading: string
}

function rgb(hex: string): string {
    return `rgb(${[1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)).join(', ')})`
}

async function expectPipelineTheme(page: Page, colors: PipelineThemeColors): Promise<void> {
    const pane = page.getByRole('region', { name: 'Stage and Pipeline Review', exact: true })
    await expect(pane).toHaveCSS('background-color', rgb(colors.background))
    await expect(pane).toHaveCSS('color', rgb(colors.text))
    await expect(pane.getByRole('heading', { level: 1 })).toHaveCSS('color', rgb(colors.heading))
    const chart = pane.getByRole('region', { name: 'ACR Actuals and Outlook' })
    await expect(chart).toHaveCSS('background-color', rgb(colors.surface))
    await expect(chart.getByRole('heading')).toHaveCSS('color', rgb(colors.heading))
    const selectedScope = pane.locator('.sprv-segmented label.active').first()
    await expect(selectedScope).toHaveCSS('background-color', rgb(colors.brand))
    await expect(selectedScope).toHaveCSS('color', rgb(colors.onBrand))
    await expect(pane.getByRole('tab', { name: /Opportunities/ })).toHaveCSS('color', rgb(colors.accent))
    await expect(pane.getByRole('button', { name: 'Reset', exact: true })).toHaveCSS('color', rgb(colors.accent))
    await expect(pane.getByRole('button', { name: 'Refresh', exact: true })).toHaveCSS('color', rgb(colors.accent))
    await expect(pane.locator('.sprv-chip').first()).toHaveCSS('color', rgb(colors.accent))
    await expect(pane.locator('.sprv-alert--red strong')).toHaveCSS('color', 'rgb(209, 52, 56)')
    for (const [label, color] of [
        ['Committed Pipe', '#1a8cff'], ['Uncommitted Pipe', '#f2c811'], ['Stage 1 Pipe', '#f8e6a0']
    ] as const) {
        await expect(chart.locator('.sprv-legend li').filter({ hasText: `$ ${label}` }).locator('.sprv-swatch')).toHaveCSS('background-color', rgb(color))
    }

    await pane.getByRole('button', { name: /^Add forecast comment to / }).first().click()
    const dialog = pane.getByRole('dialog', { name: 'Add forecast comment' })
    await expect(dialog).toHaveCSS('color', rgb(colors.text))
    await expect(dialog).toHaveCSS('background-color', rgb(colors.surface))
    await dialog.getByLabel('New update').fill('Synthetic theme validation update.')
    await expect(dialog.getByLabel('New update')).toHaveCSS('color', rgb(colors.text))
    const save = dialog.getByRole('button', { name: 'Save to MSX' })
    await expect(save).toHaveCSS('background-color', rgb(colors.brand))
    await expect(save).toHaveCSS('color', rgb(colors.onBrand))
    const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true })
    await expect(cancel).toHaveCSS('background-color', rgb(colors.surface))
    await expect(cancel).toHaveCSS('color', rgb(colors.accent))
    await cancel.click()
    await expect(dialog).toHaveCount(0)
}

for (const name of ['light', 'dark']) {
    test(`Stage and Pipeline Review uses the shared Desktop/Web ${name} palette`, async ({ page }) => {
        await page.setViewportSize({ width: 1600, height: 1100 })
        await page.goto(`/?scoutTheme=${name}`)
        await openStagePipelineReview(page)
        await expect(page.locator('html')).toHaveAttribute('data-theme', name)
        const colors = await page.locator('.fluent-root').evaluate((element) => {
            const style = getComputedStyle(element)
            return {
                background: style.getPropertyValue('--colorNeutralBackground2').trim(),
                surface: style.getPropertyValue('--colorNeutralBackground1').trim(),
                text: style.getPropertyValue('--colorNeutralForeground1').trim(),
                accent: style.getPropertyValue('--colorBrandForeground1').trim(),
                brand: style.getPropertyValue('--colorBrandBackground').trim(),
                onBrand: style.getPropertyValue('--colorNeutralForegroundOnBrand').trim(),
                heading: style.getPropertyValue('--colorPaletteTealForeground2').trim()
            }
        })
        await expectPipelineTheme(page, colors)
    })
}

for (const theme of [
    { name: 'dark', background: '#1e1e1e', surface: '#252526', text: '#cccccc', muted: '#969696', border: '#454545', accent: '#3794ff', heading: '#29b8db' },
    { name: 'light', background: '#ffffff', surface: '#f3f3f3', text: '#333333', muted: '#616161', border: '#d1d1d1', accent: '#006ab1', heading: '#006a7a' }
]) {
    test(`Stage and Pipeline Review matches Portfolio colors in the VS Code ${theme.name} webview`, async ({ page }) => {
        await page.setViewportSize({ width: 1600, height: 1100 })
        const colors = { ...theme, brand: '#0078d4', onBrand: '#ffffff' }
        await page.route('**/', (route) => route.fulfill({
            contentType: 'text/html',
            body: `<!doctype html><html><head><style>:root{color-scheme:${theme.name};--vscode-editor-background:${colors.background};--vscode-editorWidget-background:${colors.surface};--vscode-foreground:${colors.text};--vscode-descriptionForeground:${theme.muted};--vscode-panel-border:${theme.border};--vscode-textLink-foreground:${colors.accent};--vscode-button-background:${colors.brand};--vscode-button-foreground:${colors.onBrand};--vscode-terminal-ansiBrightCyan:${colors.heading};--vscode-focusBorder:${colors.brand};--vscode-font-family:"Segoe UI",sans-serif}</style></head><body><div id="root" data-mode="sample"></div></body></html>`
        }))
        await page.addInitScript((snapshot) => {
            Object.defineProperty(window, 'acquireVsCodeApi', {
                value: () => ({
                    getState: () => undefined, setState: () => undefined,
                    postMessage: (message: { kind: string; id: string; method: string }) => {
                        if (message.kind !== 'request') return
                        const result = message.method === 'stagePipelineReview' ? snapshot
                            : message.method === 'getCurrentUserEmail' ? null : []
                        window.postMessage({ kind: 'response', id: message.id, ok: true, result }, window.location.origin)
                    }
                })
            })
        }, createSampleStagePipelineReview())
        await page.goto('/')
        await page.addStyleTag({ path: resolve('apps', 'vscode-extension', 'dist', 'webview', 'webview.css') })
        await page.addScriptTag({ path: resolve('apps', 'vscode-extension', 'dist', 'webview', 'webview.js') })
        await openStagePipelineReview(page)
        await expectPipelineTheme(page, colors)
    })
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