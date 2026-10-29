import { expect, test } from '@playwright/test'
import { momentumJourney } from '../momentum-journey.js'

test('Momentum Teams uses the authorized read operation and the identical four-surface journey', async ({ page }) => {
    let reads = 0
    page.on('request', (request) => { if (request.url().includes('/operations/momentumFocus')) reads++ })
    await page.goto('/')
    await momentumJourney(page)
    expect(reads).toBe(2)
})
