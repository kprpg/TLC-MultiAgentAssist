import { expect, test } from '@playwright/test'

test('runs the static web rendering with hierarchical blades', async ({ page }) => {
    const pageErrors: Error[] = []
    let emailMarkdown = ''
    let exportMarkdown = ''
    page.on('pageerror', (error) => pageErrors.push(error))
    await page.route('**/api/open-email-compose', async (route) => {
        emailMarkdown = (route.request().postDataJSON() as { responseMarkdown: string }).responseMarkdown
        await route.fulfill({
            status: 200,
            contentType: 'message/rfc822',
            headers: { 'x-tlc-file-name': 'guidance.eml' },
            body: 'MIME-Version: 1.0'
        })
    })
    await page.route('**/api/export-agent-response', async (route) => {
        exportMarkdown = (route.request().postDataJSON() as { responseMarkdown: string }).responseMarkdown
        await route.fulfill({
            status: 200,
            contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            headers: { 'x-tlc-file-name': 'guidance.docx' },
            body: 'test document'
        })
    })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')

    await expect(page).toHaveTitle('TLC Account Team Intelligence | Web')
    await expect(page.getByText('STATIC WEB · SAMPLE DATA')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Select a customer account' })).toBeVisible()
    await page.getByRole('button', { name: /Fabrikam Retail/ }).first().click()
    await expect(page.getByRole('region', { name: 'Opportunity workbench' }).getByRole('heading', { name: 'Fabrikam Retail' })).toBeVisible()
    await page.getByRole('region', { name: 'Opportunities blade' }).getByRole('button', { name: /^Customer data platform - ready to advance / }).click()

    await expect(page.getByRole('region', { name: 'Milestones blade' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Opportunities blade' }).getByRole('button', { name: /^Customer data platform - ready to advance / })).toContainText('Morgan Lee · Stage 2 · $3.2M · 2027-01-15')
    const selectedOpportunity = page.getByRole('treeitem', { name: /Customer data platform - ready to advance/ })
    await expect(selectedOpportunity).toHaveAttribute('aria-expanded', 'true')
    await expect(selectedOpportunity.getByRole('group')).toContainText('Technical validation workshop')
    await expect(page.getByRole('region', { name: 'Opportunity workbench' })).toContainText('Morgan Lee · Stage 2 · $3.2M · closes 2027-01-15')
    await selectedOpportunity.getByRole('button', { name: /^Customer data platform - ready to advance / }).click()
    await expect(selectedOpportunity).toHaveAttribute('aria-expanded', 'false')
    await expect(selectedOpportunity.getByRole('group')).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Opportunity workbench' })).toContainText('Morgan Lee · Stage 2 · $3.2M · closes 2027-01-15')
    await selectedOpportunity.getByRole('button', { name: /^Customer data platform - ready to advance / }).click()
    await expect(selectedOpportunity).toHaveAttribute('aria-expanded', 'true')
    await expect(selectedOpportunity.getByRole('group')).toContainText('Technical validation workshop')
    await expect(page.getByRole('region', { name: 'Opportunity workbench' })).toContainText('Stage 3')
    await expect(page.getByRole('complementary', { name: 'Next best actions blade' })).toContainText('Confirm progression to Stage 3')
    await page.getByRole('button', { name: 'Refresh Milestones' }).click()
    await expect(selectedOpportunity.getByRole('group')).toContainText('Technical validation workshop')
    await page.getByRole('tab', { name: 'Multi-Agent Guidance' }).click()
    await expect(page.locator('.agent-response')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'What should the account team focus on this week?' })).toBeVisible()
    const guidanceGeometry = await page.evaluate(() => {
        const cards = [...document.querySelectorAll<HTMLElement>('.agent-prompt-suggestions button')]
        const first = cards[0]?.getBoundingClientRect()
        const third = cards[2]?.getBoundingClientRect()
        const composer = document.querySelector<HTMLElement>('.agent-composer textarea')?.getBoundingClientRect()
        if (!first || !third || !composer) throw new Error('Expected guidance controls are missing.')
        return {
            cardHeight: first.height,
            rowGap: third.top - first.bottom,
            composerHeight: composer.height
        }
    })
    expect(guidanceGeometry.cardHeight).toBeLessThanOrEqual(39)
    expect(guidanceGeometry.rowGap).toBeLessThanOrEqual(5)
    expect(guidanceGeometry.composerHeight).toBeLessThanOrEqual(48)
    await page.getByRole('button', { name: 'What should the account team focus on this week?' }).click()
    await expect(page.getByText('sanitized web-preview evidence')).toBeVisible()
    await expect(page.locator('.agent-response-markdown h2')).toHaveText(['account pulse', 'Owner-based plan to close gaps', 'Recommended sequence', 'Assumptions / cautions'])
    await expect(page.locator('.agent-response-markdown h3')).toHaveText('ATS — Customer outcomes')
    await expect(page.locator('.agent-response-markdown li strong')).toHaveText(['Gap:', 'Evidence:'])
    await expect(page.locator('.agent-response')).toHaveCSS('margin-top', '8px')
    await expect(page.getByRole('button', { name: 'Send Email' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Export' })).toBeVisible()
    await page.getByRole('button', { name: 'Send Email' }).click()
    await page.getByRole('textbox', { name: 'Email recipients' }).fill('reviewer@example.com')
    await page.getByRole('button', { name: 'Download Draft' }).click()
    await expect.poll(() => emailMarkdown).toContain('## Recommended sequence')
    expect(emailMarkdown).toContain('### ATS — Customer outcomes')
    expect(emailMarkdown).toContain('**MSX Opportunity:** [Open opportunity in MSX]')
    await page.getByRole('button', { name: 'Export' }).click()
    await expect.poll(() => exportMarkdown).toContain('## Recommended sequence')
    expect(exportMarkdown).toContain('### ATS — Customer outcomes')
    await page.getByRole('button', { name: 'Close Next best actions' }).click()
    await expect(page.getByRole('complementary', { name: 'Next best actions blade' })).toHaveCount(0)
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

test('sorts opportunities by close date, stage, and value across refreshes', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /Contoso Energy/ }).first().click()
    const blade = page.getByRole('region', { name: 'Opportunities blade' })
    const firstOpportunity = blade.locator('.opportunity-node').first()

    await expect(firstOpportunity).toContainText('Resilient cloud foundation - ready to advance')

    await blade.getByRole('button', { name: 'Sort opportunities' }).click()
    await page.getByRole('menuitemradio', { name: 'Stage' }).click()
    await expect(firstOpportunity).toContainText('Grid operations modernization')

    await blade.getByRole('button', { name: 'Sort opportunities' }).click()
    await page.getByRole('menuitemradio', { name: '$ Value', exact: true }).click()
    await expect(firstOpportunity).toContainText('Grid operations modernization')

    await blade.getByRole('button', { name: 'Refresh Opportunities' }).click()
    await expect(firstOpportunity).toContainText('Grid operations modernization')
    await expect(blade.getByRole('button', { name: 'Sort opportunities' })).toHaveAttribute('title', 'Sort opportunities by Value')

    await blade.getByRole('button', { name: 'Sort opportunities' }).click()
    await page.getByRole('menuitemradio', { name: 'Close Date' }).click()
    await expect(firstOpportunity).toContainText('Resilient cloud foundation - ready to advance')
})

test('offers milestone sorting beside the milestone refresh control', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /Contoso Energy/ }).first().click()
    await page.getByRole('region', { name: 'Opportunities blade' }).getByRole('button', { name: /^Grid operations modernization / }).click()

    const milestoneGroup = page.getByRole('group', { name: 'Grid operations modernization milestones' })
    const sortButton = milestoneGroup.getByRole('button', { name: 'Sort milestones' })
    const refreshButton = milestoneGroup.getByRole('button', { name: 'Refresh Milestones' })
    const [sortBox, refreshBox] = await Promise.all([sortButton.boundingBox(), refreshButton.boundingBox()])

    expect(sortBox).not.toBeNull()
    expect(refreshBox).not.toBeNull()
    expect(sortBox!.x).toBeLessThan(refreshBox!.x)

    await sortButton.click()
    await expect(page.getByRole('menuitemradio', { name: 'Milestone Est. Date' })).toBeVisible()
    await expect(page.getByRole('menuitemradio', { name: 'Est. Change in Monthly Usage ($ Value)', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitemradio', { name: 'Customer Commitment' })).toBeVisible()
    await expect(page.getByRole('menuitemradio', { name: 'Milestone Status' })).toBeVisible()
})

test('edits milestone fields and opportunity comments with save and cancel', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await page.getByRole('button', { name: /Contoso Energy/ }).first().click()
    const opportunityButton = page.getByRole('region', { name: 'Opportunities blade' }).getByRole('button', { name: /^Grid operations modernization / })
    await opportunityButton.click()

    const editMilestone = page.getByRole('button', { name: 'Edit Customer outcome validation' })
    const openMilestoneEditor = async (name: string) => {
        await editMilestone.click()
        await page.getByRole('menuitem', { name, exact: true }).click()
    }

    await openMilestoneEditor('Milestone Status')
    const status = page.getByRole('combobox')
    await expect(status.locator('option')).toHaveText([
        'On Track',
        'At Risk',
        'Blocked',
        'Completed',
        'Cancelled',
        'Lost to Competitor',
        'Hygiene/Duplicate'
    ])
    await status.selectOption({ label: 'At Risk' })
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('treeitem', { name: /Customer outcome validation/ })).toContainText('At Risk')

    await openMilestoneEditor('Risk/Blocker Details')
    await expect(page.getByRole('textbox', { name: 'Risk/Blocker Details' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()

    await openMilestoneEditor('Milestone Est Date')
    await expect(page.locator('input[type="date"]')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()

    await openMilestoneEditor('Customer Commitment')
    await expect(page.getByRole('combobox').locator('option')).toHaveText(['Uncommitted', 'Committed'])
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()

    await openMilestoneEditor('Milestone Comments')
    await expect(page.getByRole('textbox', { name: 'Milestone Comments' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()

    const opportunityTreeItem = page.getByRole('treeitem', { name: /Grid operations modernization/ })
    await page.getByRole('button', { name: 'Edit Grid operations modernization' }).click()
    await page.getByRole('menuitem', { name: 'Opportunity Comments' }).click()
    const comments = opportunityTreeItem.getByRole('textbox', { name: 'Opportunity Comments' })
    await expect(page.getByRole('region', { name: 'Opportunity workbench' }).getByRole('textbox', { name: 'Opportunity Comments' })).toHaveCount(0)
    const originalComments = await comments.inputValue()
    await comments.fill('Discard this draft')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()

    await opportunityButton.click({ button: 'right' })
    await expect(comments).toHaveValue(originalComments)
    await comments.fill('Executive sponsor aligned')
    await page.getByRole('button', { name: 'Save', exact: true }).click()

    await opportunityButton.click({ button: 'right' })
    await expect(comments).toHaveValue('Executive sponsor aligned')
})

test('governs adjacent MCEM board advances, exceptions, and recycle moves', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await page.getByRole('button', { name: /Fabrikam Retail/ }).first().click()
    await page.getByRole('region', { name: 'Opportunities blade' }).getByRole('button', { name: /^Customer data platform - ready to advance / }).click()
    await page.getByRole('tab', { name: 'MCEM Stage Management' }).click()

    const board = page.getByLabel('MCEM stages for Fabrikam Retail')
    await expect(board.getByLabel('Stage 1: Listen & Consult')).toBeVisible()
    await expect(board.getByLabel('Stage 5: Manage & Optimize')).toBeVisible()
    await expect(board.locator('.mcem-card.selected')).toContainText('Customer data platform - ready to advance')

    await board.getByRole('button', { name: 'Move Customer data platform - ready to advance to next stage' }).click()
    await expect(page.getByRole('dialog')).toContainText('Stage 2 → Stage 3')
    await page.getByRole('button', { name: 'Confirm move' }).click()
    await expect(board.getByLabel('Stage 3: Empower & Achieve')).toContainText('Customer data platform - ready to advance')

    await board.getByRole('button', { name: 'Move Customer data platform - ready to advance to previous stage' }).click()
    await expect(page.getByText('This move recycles the opportunity to a previous stage.')).toBeVisible()
    const recycleReason = page.getByRole('textbox', { name: 'Reason' })
    await expect(page.getByRole('button', { name: 'Confirm move' })).toBeDisabled()
    await recycleReason.fill('Customer scope requires renewed discovery.')
    await page.getByRole('button', { name: 'Confirm move' }).click()
    await expect(board.getByLabel('Stage 2: Inspire & Design')).toContainText('Customer data platform - ready to advance')

    await board.getByRole('button', { name: 'Move AI-assisted customer service to next stage' }).click()
    await expect(page.getByText('Some exit criteria are incomplete. This move will be recorded as an exception.')).toBeVisible()
    await page.getByRole('textbox', { name: 'Reason' }).fill('Executive approved proceeding with tracked gaps.')
    await page.getByRole('button', { name: 'Confirm move' }).click()
    await expect(board.getByLabel('Stage 3: Empower & Achieve')).toContainText('AI-assisted customer service')
})

test('uses Fluent theme tokens and readable compact typography', async ({ page }) => {
    await page.goto('/?scoutTheme=dark')

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.locator('.fluent-root')).toBeVisible()

    const styles = await page.evaluate(() => {
        const provider = document.querySelector<HTMLElement>('.fluent-root')
        const intro = document.querySelector<HTMLElement>('.blade-intro')
        const workspace = document.querySelector<HTMLElement>('.workspace')
        const shell = document.querySelector<HTMLElement>('.app-shell')
        const bladeHeader = document.querySelector<HTMLElement>('.blade-header')
        const accountButton = document.querySelector<HTMLElement>('.account-button')
        const exitLabel = document.querySelector<HTMLElement>('.exit-label')
        if (!provider || !intro || !workspace || !shell || !bladeHeader || !accountButton || !exitLabel) {
            throw new Error('Expected revamp layout elements are missing.')
        }
        return {
            backgroundToken: getComputedStyle(provider).getPropertyValue('--colorNeutralBackground1').trim(),
            bodyFontSize: getComputedStyle(document.body).fontSize,
            introFontSize: getComputedStyle(intro).fontSize,
            overflowX: getComputedStyle(workspace).overflowX,
            shellRows: getComputedStyle(shell).gridTemplateRows,
            bladeHeaderMinHeight: getComputedStyle(bladeHeader).minHeight,
            bladeTitleFontSize: getComputedStyle(bladeHeader.querySelector('h2')!).fontSize,
            accountPadding: getComputedStyle(accountButton).padding,
            accountTitleFontSize: getComputedStyle(accountButton.querySelector('strong')!).fontSize,
            fluentButtonFontSize: getComputedStyle(exitLabel).fontSize
        }
    })

    expect(styles.backgroundToken).not.toBe('')
    expect(styles.bodyFontSize).toBe('12px')
    expect(styles.introFontSize).toBe('11px')
    expect(styles.overflowX).toBe('auto')
    expect(styles.shellRows.split(' ')[0]).toBe('44px')
    expect(styles.bladeHeaderMinHeight).toBe('52px')
    expect(styles.bladeTitleFontSize).toBe('14px')
    expect(styles.accountPadding).toBe('7px 8px')
    expect(styles.accountTitleFontSize).toBe('12px')
    expect(styles.fluentButtonFontSize).toBe('12px')
})

test('resizes blades by dragging and restores persisted widths after collapse and reload', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')

    const accountsBlade = page.getByRole('region', { name: 'Accounts blade' })
    const resizeHandle = page.getByRole('separator', { name: 'Resize Accounts blade' })
    const initialWidth = (await accountsBlade.boundingBox())!.width
    const handleBox = (await resizeHandle.boundingBox())!

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 100)
    await page.mouse.down()
    await page.mouse.move(handleBox.x + handleBox.width / 2 + 80, handleBox.y + 100)
    await page.mouse.up()

    const resizedWidth = (await accountsBlade.boundingBox())!.width
    expect(resizedWidth).toBeGreaterThan(initialWidth + 70)

    const resizedHandleBox = (await resizeHandle.boundingBox())!
    await page.mouse.move(resizedHandleBox.x + resizedHandleBox.width / 2, resizedHandleBox.y + 100)
    await page.mouse.down()
    await page.mouse.move(resizedHandleBox.x + resizedHandleBox.width / 2 - 30, resizedHandleBox.y + 100)
    await page.mouse.up()
    const finalWidth = (await accountsBlade.boundingBox())!.width
    expect(finalWidth).toBeLessThan(resizedWidth - 20)

    await page.getByRole('button', { name: 'Collapse Accounts blade header' }).click()
    await expect.poll(async () => (await accountsBlade.boundingBox())!.width).toBe(44)
    await page.getByRole('button', { name: 'Expand Accounts blade header' }).click()
    await expect.poll(async () => (await accountsBlade.boundingBox())!.width).toBeCloseTo(finalWidth, 0)

    await page.reload()
    await expect.poll(async () => (await accountsBlade.boundingBox())!.width).toBeCloseTo(finalWidth, 0)
})

test('uses mobile drill-down navigation without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.getByRole('button', { name: /Contoso Energy/ }).first().click()
    await expect(page.getByRole('region', { name: 'Opportunities blade' })).toBeVisible()
    await page.getByRole('button', { name: /^Cloud security readiness / }).click()
    await expect(page.getByRole('region', { name: 'Opportunities blade' }).getByRole('treeitem', { name: /Cloud security readiness/ }).getByRole('group')).toBeVisible()
    await page.getByRole('button', { name: /Analysis/ }).click()
    await expect(page.getByRole('region', { name: 'Opportunity workbench' })).toBeVisible()
    await page.getByRole('button', { name: /Actions/ }).click()
    await expect(page.getByRole('complementary', { name: 'Next best actions blade' })).toBeVisible()
    await expect(page.getByRole('separator')).toHaveCount(0)

    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(hasOverflow).toBe(false)
})