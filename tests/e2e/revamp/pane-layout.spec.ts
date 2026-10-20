import { expect, test, _electron as electron, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

async function expectBoundedScrollablePanes(page: Page): Promise<void> {
    await page.setViewportSize({ width: 1366, height: 600 })
    const accounts = page.getByRole('region', { name: 'Accounts blade' })
    await accounts.getByRole('button', { name: /Contoso Energy/ }).click()
    const opportunities = page.getByRole('region', { name: 'Opportunities blade' })
    await opportunities.getByRole('button', { name: /^Grid operations modernization / }).click()
    const milestones = opportunities.getByRole('region', { name: 'Grid operations modernization milestones' })
    await expect(milestones).toContainText('Customer outcome validation')

    // Stress the layout with rendered canonical rows, without introducing a second sample dataset.
    await milestones.locator('tbody').evaluate((body) => {
        const row = body.querySelector('tr')
        if (!row) throw new Error('Expected a sample milestone row.')
        for (let index = 0; index < 20; index += 1) body.appendChild(row.cloneNode(true))
    })
    await expect(milestones).toHaveCSS('overflow-y', 'scroll')
    await expect.poll(() => milestones.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0)
    await milestones.evaluate((element) => { element.scrollTop = element.scrollHeight })
    expect(await milestones.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await expect(milestones.locator('tbody tr').last()).toBeInViewport()

    const workbench = page.getByRole('region', { name: 'Opportunity workbench' })
    await workbench.getByRole('tab', { name: 'Multi-Agent Guidance' }).click()
    await workbench.getByRole('button', { name: 'What should the account team focus on this week?' }).click()
    await expect(workbench.locator('.agent-response-markdown')).not.toBeEmpty()
    const content = workbench.locator('.workbench-pane-content')
    await expect(content).toHaveCSS('overflow-y', 'scroll')

    for (const height of [600, 768, 1080]) {
        await page.setViewportSize({ width: 1366, height })
        await content.evaluate((element) => { element.scrollTop = element.scrollHeight })
        await expect(workbench.getByRole('button', { name: 'Collapse Guidance pane' })).toBeInViewport()
        await expect(workbench.getByRole('button', { name: 'Maximize Guidance pane' })).toBeInViewport()
        const geometry = await page.evaluate(() => ({
            viewportHeight: innerHeight,
            documentHeight: document.documentElement.scrollHeight,
            paneBottoms: [...document.querySelectorAll('.workspace, .blade, .center-pane, .milestone-table-wrap')]
                .map((element) => element.getBoundingClientRect().bottom)
        }))
        expect(geometry.documentHeight).toBeLessThanOrEqual(geometry.viewportHeight)
        for (const bottom of geometry.paneBottoms) expect(bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1)
    }

    await page.setViewportSize({ width: 1366, height: 600 })
    await expect.poll(() => content.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0)
    await content.evaluate((element) => { element.scrollTop = element.scrollHeight })
    expect(await content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await expect(workbench.locator('.agent-response-markdown').last()).toBeInViewport()

    const initialWidth = (await workbench.boundingBox())!.width
    const draft = workbench.getByRole('textbox', { name: 'Agent task', exact: true })
    await draft.fill('Preserve this question when resizing the pane.')
    await workbench.getByRole('button', { name: 'Maximize Guidance pane' }).click()
    await expect(accounts).toBeHidden()
    await expect(opportunities).toBeHidden()
    await expect(page.getByRole('complementary', { name: 'Next best actions blade' })).toBeHidden()
    await expect.poll(async () => (await workbench.boundingBox())!.width).toBeGreaterThan(initialWidth + 400)
    await expect(workbench.getByRole('button', { name: 'Restore Guidance pane' })).toHaveAttribute('aria-pressed', 'true')
    await expect(draft).toHaveValue('Preserve this question when resizing the pane.')
    await workbench.getByRole('button', { name: 'Restore Guidance pane' }).click()
    await expect(accounts).toBeVisible()
    await expect(opportunities).toBeVisible()
    await expect.poll(async () => (await workbench.boundingBox())!.width).toBeCloseTo(initialWidth, 0)
    await expect(draft).toHaveValue('Preserve this question when resizing the pane.')

    await content.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await workbench.getByRole('button', { name: 'Collapse Guidance pane' }).click()
    await expect(content).toBeHidden()
    await workbench.getByRole('button', { name: 'Expand Guidance pane' }).click()
    await expect(content).toBeVisible()
    await expect(draft).toHaveValue('Preserve this question when resizing the pane.')
}

test('keeps Milestones and Guidance bounded, scrollable and expandable in Web', async ({ page }) => {
    await page.goto('/')
    await expectBoundedScrollablePanes(page)
})

test('keeps the Desktop window inside the work area and its panes scrollable and expandable', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-pane-layout-'))
    const app = await electron.launch({
        args: [resolve('apps/desktop'), `--user-data-dir=${userDataDirectory}`],
        env: { ...process.env, TLC_DATA_MODE: 'sample', TLC_UI_MODE: '' }
    })
    try {
        const window = await app.firstWindow()
        const { contentBounds, workArea } = await app.evaluate(({ BrowserWindow, screen }) => {
            const window = BrowserWindow.getAllWindows()[0]!
            return { contentBounds: window.getContentBounds(), workArea: screen.getDisplayMatching(window.getBounds()).workArea }
        })
        // Windows outer bounds include invisible resize borders at fractional display scales.
        expect(contentBounds.x).toBeGreaterThanOrEqual(workArea.x)
        expect(contentBounds.y).toBeGreaterThanOrEqual(workArea.y)
        expect(contentBounds.x + contentBounds.width).toBeLessThanOrEqual(workArea.x + workArea.width)
        expect(contentBounds.y + contentBounds.height).toBeLessThanOrEqual(workArea.y + workArea.height)
        await expectBoundedScrollablePanes(window)
    } finally {
        await app.close()
        await rm(userDataDirectory, { recursive: true, force: true })
    }
})
