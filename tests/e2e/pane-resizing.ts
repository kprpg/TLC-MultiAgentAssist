import { expect, type Locator, type Page } from '@playwright/test'

export async function expectPaneResizing(page: Page, handle: Locator, pane: Locator, reversed = false): Promise<void> {
    await expect(handle.locator('.pane-resize-grip > span')).toHaveCount(3)
    const initialWidth = (await pane.boundingBox())!.width
    await handle.hover()
    expect(await handle.evaluate((element) => getComputedStyle(element, '::after').backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
    const box = (await handle.boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + Math.min(box.height / 2, 80)
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + (reversed ? -60 : 60), y, { steps: 8 })
    await expect(handle).toHaveClass(/is-dragging/)
    await page.mouse.up()
    await expect(page.locator('body')).not.toHaveClass(/resizing-pane/)
    await expect.poll(async () => (await pane.boundingBox())!.width).toBeCloseTo(initialWidth + 60, 0)

    await handle.press(reversed ? 'ArrowLeft' : 'ArrowRight')
    await expect.poll(async () => (await pane.boundingBox())!.width).toBeCloseTo(initialWidth + 70, 0)
    await handle.press('Home')
    const minimum = Number(await handle.getAttribute('aria-valuemin'))
    await expect.poll(async () => (await pane.boundingBox())!.width).toBeCloseTo(minimum, 0)
    await handle.press('End')
    const maximum = Number(await handle.getAttribute('aria-valuemax'))
    await expect.poll(async () => (await pane.boundingBox())!.width).toBeCloseTo(maximum, 0)
    await handle.dblclick()
    await expect.poll(async () => (await pane.boundingBox())!.width).toBeCloseTo(initialWidth, 0)
}

export async function expectHorizontalPaneScroll(area: Locator): Promise<void> {
    await expect(area).toHaveCSS('overflow-x', 'auto')
    await expect.poll(() => area.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeGreaterThan(0)
    await area.evaluate((element) => { element.scrollLeft = element.scrollWidth })
    expect(await area.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
}

export async function expectGuidancePaneMaximizing(pane: Locator, draft: Locator, surroundingPanes: Locator[], expectGrowth = true): Promise<void> {
    const initialWidth = (await pane.boundingBox())!.width
    const initialDraft = await draft.inputValue()
    const visibility = await Promise.all(surroundingPanes.map((item) => item.isVisible()))
    const maximize = pane.getByRole('button', { name: 'Maximize Guidance pane', exact: true })
    await expect(maximize).toHaveAttribute('aria-pressed', 'false')
    await maximize.focus()
    await maximize.press('Enter')
    const restore = pane.getByRole('button', { name: 'Restore Guidance pane', exact: true })
    await expect(restore).toHaveAttribute('aria-pressed', 'true')
    await expect(restore).toBeFocused()
    for (const [index, item] of surroundingPanes.entries()) {
        await expect(item).toBeHidden()
        if (visibility[index]) await expect(item).toHaveCount(1)
    }
    if (expectGrowth) await expect.poll(async () => (await pane.boundingBox())!.width).toBeGreaterThan(initialWidth + 100)
    await expect(draft).toHaveValue(initialDraft)
    await restore.press('Space')
    await expect(maximize).toHaveAttribute('aria-pressed', 'false')
    for (const [index, item] of surroundingPanes.entries()) {
        if (visibility[index]) await expect(item).toBeVisible()
        else await expect(item).toBeHidden()
    }
    await expect.poll(async () => (await pane.boundingBox())!.width).toBeCloseTo(initialWidth, 0)
    await expect(draft).toHaveValue(initialDraft)
}
