import { expect, test } from '@playwright/test'

test('runs the static web rendering with hierarchical blades', async ({ page }) => {
    const pageErrors: Error[] = []
    page.on('pageerror', (error) => pageErrors.push(error))
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')

    await expect(page).toHaveTitle('TLC Account Team Intelligence | Web')
    await expect(page.getByText('STATIC WEB · SAMPLE DATA')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Select a customer account' })).toBeVisible()
    await page.getByRole('button', { name: /Fabrikam Retail/ }).first().click()
    await expect(page.getByRole('region', { name: 'Opportunity workbench' }).getByRole('heading', { name: 'Fabrikam Retail' })).toBeVisible()
    await page.getByRole('region', { name: 'Opportunities blade' }).getByRole('button', { name: /Customer data platform - ready to advance/ }).click()

    await expect(page.getByRole('region', { name: 'Milestones blade' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Opportunity workbench' })).toContainText('Stage 3')
    await expect(page.getByRole('complementary', { name: 'Next best actions blade' })).toContainText('Confirm progression to Stage 3')
    await page.getByRole('button', { name: 'Refresh Milestones' }).click()
    await expect(page.getByRole('region', { name: 'Milestones blade' })).toContainText('Confirm progression to Stage 3')
    await page.getByRole('tab', { name: 'Multi-Agent Guidance' }).click()
    await expect(page.locator('.agent-response')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'What should the account team focus on this week?' })).toBeVisible()
    await page.getByRole('button', { name: 'What should the account team focus on this week?' }).click()
    await expect(page.getByText('sanitized web-preview evidence')).toBeVisible()
    await expect(page.locator('.agent-response-markdown h2')).toHaveText('account pulse')
    await expect(page.getByRole('button', { name: 'Send Email' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Export' })).toBeVisible()
    await page.getByRole('button', { name: 'Close Next best actions' }).click()
    await expect(page.getByRole('complementary', { name: 'Next best actions blade' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Close Milestones' }).click()
    await expect(page.getByRole('region', { name: 'Milestones blade' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Opportunities blade' })).toBeVisible()
    expect(pageErrors).toEqual([])
})

test('searches accounts and opportunities and reports no matches', async ({ page }) => {
    await page.goto('/')
    const search = page.getByRole('searchbox', { name: 'Search accounts and opportunities' })

    await search.fill('Fabrikam')
    await search.press('Enter')
    await expect(page.getByRole('region', { name: 'Opportunity workbench' }).getByRole('heading', { name: 'Fabrikam Retail' })).toBeVisible()

    await search.fill('Customer data platform')
    await page.getByRole('option', { name: /Customer data platform.*Fabrikam Retail/ }).click()
    await expect(page.getByRole('region', { name: 'Opportunity workbench' }).getByRole('heading', { name: 'Customer data platform - ready to advance' })).toBeVisible()

    await search.fill('not a real account')
    await expect(page.getByRole('status')).toHaveText('No accounts or opportunities found.')
})

test('uses Fluent theme tokens and readable compact typography', async ({ page }) => {
    await page.goto('/?scoutTheme=dark')

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.locator('.fluent-root')).toBeVisible()

    const styles = await page.evaluate(() => {
        const provider = document.querySelector<HTMLElement>('.fluent-root')
        const intro = document.querySelector<HTMLElement>('.blade-intro')
        const workspace = document.querySelector<HTMLElement>('.workspace')
        if (!provider || !intro || !workspace) throw new Error('Expected revamp layout elements are missing.')
        return {
            backgroundToken: getComputedStyle(provider).getPropertyValue('--colorNeutralBackground1').trim(),
            introFontSize: getComputedStyle(intro).fontSize,
            overflowX: getComputedStyle(workspace).overflowX
        }
    })

    expect(styles.backgroundToken).not.toBe('')
    expect(styles.introFontSize).toBe('12px')
    expect(styles.overflowX).toBe('auto')
})

test('uses mobile drill-down navigation without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.getByRole('button', { name: /Contoso Energy/ }).first().click()
    await expect(page.getByRole('region', { name: 'Opportunities blade' })).toBeVisible()
    await page.getByRole('button', { name: /Cloud security readiness/ }).click()
    await expect(page.getByRole('region', { name: 'Milestones blade' })).toBeVisible()
    await page.getByRole('button', { name: /Analysis/ }).click()
    await expect(page.getByRole('region', { name: 'Opportunity workbench' })).toBeVisible()
    await page.getByRole('button', { name: /Actions/ }).click()
    await expect(page.getByRole('complementary', { name: 'Next best actions blade' })).toBeVisible()

    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(hasOverflow).toBe(false)
})